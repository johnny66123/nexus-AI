import PDFDocument from 'pdfkit';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { RESEARCH_TYPE_CATALOG } from '../shared/schema.ts';
import type { ResearchProject } from '../shared/schema.ts';

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export async function generateResearchPdfBuffer(project: ResearchProject): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: project.title,
        Author: 'NEXUS AI Intelligence Engine',
        Subject: project.question,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const typeLabel =
      RESEARCH_TYPE_CATALOG.find((t) => t.id === project.researchType)?.label ??
      project.researchType;

    // Header
    doc.fontSize(10).fillColor('#2563EB').text('NEXUS INTELLIGENCE ENGINE — RESEARCH REPORT');
    doc.moveDown(0.3);
    doc.fontSize(20).fillColor('#0F172A').text(project.title);
    doc.moveDown(0.4);
    doc
      .fontSize(9.5)
      .fillColor('#475569')
      .text(
        `Research Type: ${typeLabel}   |   Source Mode: ${project.sourceMode}   |   Status: ${project.status}   |   Search Health: ${project.searchHealth}`,
      );
    doc.text(`Question: ${project.question}`);
    doc.text(`Generated: ${new Date(project.createdAt).toUTCString()}`);
    doc.moveDown(0.8);

    if (project.searchHealth !== 'healthy' && project.searchHealth !== 'not_requested') {
      doc
        .fontSize(9.5)
        .fillColor('#B45309')
        .text(
          `Integrity Notice: Search health was "${project.searchHealth}". Treat single-source or missing web results cautiously.`,
        );
      doc.moveDown(0.6);
    }

    const sections: Array<[string, string]> = [
      ['1. Executive Summary', project.report.executiveSummary],
      ['2. Research Objectives', project.report.researchObjectives],
      ['3. Methodology', project.report.methodology],
      ['4. Main Findings', project.report.mainFindings],
      ['5. Evidence and Citations', project.report.evidenceAndCitations],
      ['6. Limitations', project.report.limitations],
      ['7. Recommendations', project.report.recommendations],
      ['8. Conclusion', project.report.conclusion],
      ['9. References', project.report.references],
    ];

    for (const [heading, body] of sections) {
      doc.fontSize(13).fillColor('#1E293B').text(heading);
      doc.moveDown(0.25);
      doc
        .fontSize(10)
        .fillColor('#334155')
        .text(stripMarkdownFormatting(body) || 'None noted.', {
          align: 'left',
          lineGap: 3,
        });
      doc.moveDown(0.8);
    }

    if (project.conflicts.length > 0) {
      doc.fontSize(13).fillColor('#1E293B').text('Conflicting Evidence Audit');
      doc.moveDown(0.25);
      for (const c of project.conflicts) {
        doc
          .fontSize(10)
          .fillColor('#0F172A')
          .text(`Topic: ${c.topic}`);
        doc
          .fontSize(9.5)
          .fillColor('#334155')
          .text(`- Position A (${c.sourceKeysA.join(', ') || 'Unspecified'}): ${c.claimA}`);
        doc.text(`- Position B (${c.sourceKeysB.join(', ') || 'Unspecified'}): ${c.claimB}`);
        doc.text(`- Note: ${c.uncertaintyNote}`);
        doc.moveDown(0.4);
      }
    }

    doc.end();
  });
}

export async function generateResearchDocxBuffer(project: ResearchProject): Promise<Buffer> {
  const typeLabel =
    RESEARCH_TYPE_CATALOG.find((t) => t.id === project.researchType)?.label ??
    project.researchType;

  const children: Paragraph[] = [
    new Paragraph({
      text: 'NEXUS INTELLIGENCE ENGINE — RESEARCH REPORT',
      heading: HeadingLevel.HEADING_4,
    }),
    new Paragraph({
      text: project.title,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Type: ${typeLabel} | Source Mode: ${project.sourceMode} | Status: ${project.status} | Search Health: ${project.searchHealth}`,
          italics: true,
          size: 20,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Research Question: ', bold: true, size: 22 }),
        new TextRun({ text: project.question, size: 22 }),
      ],
    }),
    new Paragraph({
      text: `Generated: ${new Date(project.createdAt).toUTCString()}`,
    }),
    new Paragraph({ text: '' }),
  ];

  const sections: Array<[string, string]> = [
    ['1. Executive Summary', project.report.executiveSummary],
    ['2. Research Objectives', project.report.researchObjectives],
    ['3. Methodology', project.report.methodology],
    ['4. Main Findings', project.report.mainFindings],
    ['5. Evidence and Citations', project.report.evidenceAndCitations],
    ['6. Limitations', project.report.limitations],
    ['7. Recommendations', project.report.recommendations],
    ['8. Conclusion', project.report.conclusion],
    ['9. References', project.report.references],
  ];

  for (const [heading, body] of sections) {
    children.push(
      new Paragraph({
        text: heading,
        heading: HeadingLevel.HEADING_1,
      }),
    );
    const lines = stripMarkdownFormatting(body).split('\n').filter(Boolean);
    if (lines.length === 0) {
      children.push(new Paragraph({ text: 'None noted.' }));
    } else {
      for (const line of lines) {
        children.push(new Paragraph({ text: line }));
      }
    }
    children.push(new Paragraph({ text: '' }));
  }

  if (project.conflicts.length > 0) {
    children.push(
      new Paragraph({
        text: 'Conflicting Evidence Audit',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    for (const c of project.conflicts) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Topic: ${c.topic}`, bold: true })],
        }),
        new Paragraph({
          text: `Position A (${c.sourceKeysA.join(', ') || 'Unspecified'}): ${c.claimA}`,
        }),
        new Paragraph({
          text: `Position B (${c.sourceKeysB.join(', ') || 'Unspecified'}): ${c.claimB}`,
        }),
        new Paragraph({ text: `Uncertainty Note: ${c.uncertaintyNote}` }),
      );
    }
  }

  const doc = new Document({
    creator: 'NEXUS AI Intelligence Engine',
    title: project.title,
    description: project.question,
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
