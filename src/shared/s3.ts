import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';
import type { DocType } from './types.js';

const s3 = new S3Client({ region: config.AWS_REGION });

export interface UploadResult {
  bucket: string;
  key: string;
  sizeBytes: number;
  checksumSha256: string;
}

function buildKey(userId: string, jobId: string, docType: DocType): string {
  return `extractions/${userId}/${jobId}/${docType}.pdf`;
}

/**
 * Sube el PDF a S3 con cifrado SSE-KMS y metadata. Calcula el checksum SHA-256.
 * Recibe un Buffer ya validado (magic bytes `%PDF-`).
 */
export async function uploadPdf(params: {
  userId: string;
  jobId: string;
  docType: DocType;
  source: string;
  body: Buffer;
}): Promise<UploadResult> {
  const key = buildKey(params.userId, params.jobId, params.docType);
  const checksumSha256 = createHash('sha256').update(params.body).digest('hex');

  await new Upload({
    client: s3,
    params: {
      Bucket: config.DOCS_BUCKET,
      Key: key,
      Body: Readable.from(params.body),
      ContentType: 'application/pdf',
      ServerSideEncryption: config.DOCS_KMS_KEY_ID ? 'aws:kms' : undefined,
      SSEKMSKeyId: config.DOCS_KMS_KEY_ID,
      Metadata: {
        jobId: params.jobId,
        userId: params.userId,
        docType: params.docType,
        source: params.source,
      },
    },
  }).done();

  return { bucket: config.DOCS_BUCKET, key, sizeBytes: params.body.length, checksumSha256 };
}

/** URL prefirmada de corta duración para que el cliente descargue el documento. */
export async function presignDownload(key: string, expiresInSeconds = 300): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: config.DOCS_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

/** Valida que el binario es realmente un PDF y supera un tamaño mínimo. */
export function isValidPdf(buf: Buffer, minBytes = 1024): boolean {
  return buf.length >= minBytes && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

export { PutObjectCommand };
