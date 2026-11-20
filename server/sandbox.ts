import util from 'node:util';
import vm from 'node:vm';
import type { LabExecutionResult } from '../shared/schema.ts';

const MAX_OUTPUT_LINES = 100;
const MAX_OUTPUT_CHARS = 16000;

export function executeSandboxedJavaScript(params: {
  code: string;
  testCode?: string;
  timeoutMs?: number;
}): LabExecutionResult {
  const start = Date.now();
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 1000, 100), 2000);
  const stdout: string[] = [];
  let totalChars = 0;

  const appendLog = (prefix: string, args: unknown[]) => {
    if (stdout.length >= MAX_OUTPUT_LINES || totalChars >= MAX_OUTPUT_CHARS) return;
    const formatted = args
      .map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 3, maxArrayLength: 40 })))
      .join(' ');
    const line = prefix ? `${prefix} ${formatted}` : formatted;
    totalChars += line.length;
    stdout.push(line.slice(0, 1000));
  };

  const sandboxConsole = Object.freeze({
    log: (...args: unknown[]) => appendLog('', args),
    info: (...args: unknown[]) => appendLog('[info]', args),
    warn: (...args: unknown[]) => appendLog('[warn]', args),
    error: (...args: unknown[]) => appendLog('[error]', args),
  });

  const testResults: { name: string; passed: boolean; error?: string }[] = [];

  const sandboxAssert = Object.freeze({
    ok(value: unknown, message = 'Assertion failed') {
      if (!value) throw new Error(message);
    },
    strictEqual(actual: unknown, expected: unknown, message?: string) {
      if (!Object.is(actual, expected)) {
        throw new Error(
          message || `Expected ${util.inspect(expected)}, got ${util.inspect(actual)}`,
        );
      }
    },
    deepStrictEqual(actual: unknown, expected: unknown, message?: string) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          message || `Deep equal failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
      }
    },
    throws(fn: () => unknown, message = 'Expected function to throw') {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      if (!threw) throw new Error(message);
    },
  });

  const moduleObj = { exports: {} as Record<string, unknown> };

  const context = vm.createContext(
    {
      console: sandboxConsole,
      assert: sandboxAssert,
      module: moduleObj,
      exports: moduleObj.exports,
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      Error,
      TypeError,
      RangeError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      test: (name: string, fn: () => void) => {
        try {
          fn();
          testResults.push({ name, passed: true });
        } catch (err) {
          testResults.push({
            name,
            passed: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    },
  );

  try {
    const wrappedUserCode = `"use strict";\n${params.code}`;
    const userScript = new vm.Script(wrappedUserCode, { filename: 'sandbox-code.js' });
    const evalResult = userScript.runInContext(context, { timeout: timeoutMs });

    // Expose exported functions directly in sandbox scope for convenient assertion tests
    if (moduleObj.exports && typeof moduleObj.exports === 'object') {
      for (const [k, v] of Object.entries(moduleObj.exports)) {
        if (!(k in context)) {
          (context as Record<string, unknown>)[k] = v;
        }
      }
    }

    if (params.testCode?.trim()) {
      const lines = params.testCode
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//'));

      // If user wrote explicit test('...', () => {}) blocks, run the full test script
      if (/\btest\s*\(/.test(params.testCode)) {
        const testScript = new vm.Script(`"use strict";\n${params.testCode}`, {
          filename: 'sandbox-tests.js',
        });
        testScript.runInContext(context, { timeout: timeoutMs });
      } else {
        // Run line-by-line assertions so each assertion reports individually
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          try {
            const lineScript = new vm.Script(`"use strict";\n${line}`, {
              filename: `test-assertion-${idx + 1}.js`,
            });
            lineScript.runInContext(context, { timeout: timeoutMs });
            testResults.push({ name: `Assertion ${idx + 1}: ${line}`, passed: true });
          } catch (err) {
            testResults.push({
              name: `Assertion ${idx + 1}: ${line}`,
              passed: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    const allTestsPassed = testResults.every((t) => t.passed);
    return {
      passed: allTestsPassed,
      stdout,
      returnValue:
        evalResult !== undefined
          ? util.inspect(evalResult, { depth: 3 })
          : Object.keys(moduleObj.exports).length > 0
            ? `Exports: ${Object.keys(moduleObj.exports).join(', ')}`
            : 'undefined',
      testResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      passed: false,
      stdout,
      returnValue: '',
      error: err instanceof Error ? err.message : String(err),
      testResults,
      durationMs: Date.now() - start,
    };
  }
}
