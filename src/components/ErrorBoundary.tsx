import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected interface error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NEXUS AI ErrorBoundary caught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#060913] px-4 text-slate-100">
          <div className="w-full max-w-md rounded-xl border border-rose-500/40 bg-[#0B1120] p-6 text-center space-y-4">
            <AlertTriangle className="mx-auto h-9 w-9 text-rose-400" />
            <h1 className="font-display text-lg font-bold text-white">Workspace Recovery Mode</h1>
            <p className="text-xs text-slate-300 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reload Interface</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
