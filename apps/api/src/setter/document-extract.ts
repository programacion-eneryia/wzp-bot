import { BadRequestException } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/**
 * Extrae el texto plano de un documento subido (PDF, DOCX o TXT) para que la
 * IA pueda analizarlo y rellenar la configuración del setter.
 */
export async function extractTextFromFile(file: {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
}): Promise<string> {
  const name = (file.originalname ?? '').toLowerCase();
  const mime = file.mimetype ?? '';

  if (name.endsWith('.pdf') || mime === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    try {
      const result = await parser.getText();
      return result.text ?? '';
    } finally {
      await parser.destroy();
    }
  }

  if (
    name.endsWith('.docx') ||
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value ?? '';
  }

  if (name.endsWith('.txt') || mime.startsWith('text/')) {
    return file.buffer.toString('utf8');
  }

  if (name.endsWith('.doc')) {
    throw new BadRequestException(
      'El formato .doc antiguo no es compatible. Guárdalo como .docx o PDF.',
    );
  }

  throw new BadRequestException(
    'Formato no soportado. Sube un PDF, un Word (.docx) o un .txt.',
  );
}
