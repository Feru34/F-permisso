// Tipos de dominio compartidos entre control-plane y worker.

export type DocType = 'IRPF_RENTA' | 'VIDA_LABORAL';

export type ExtractionStatus =
  | 'PENDING'
  | 'AWAITING_CLAVE'
  | 'VALIDATED'
  | 'DOWNLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED_WAF'
  | 'EXPIRED';

export type DocSource = 'AEAT' | 'TGSS';

export interface JobParams {
  /** Identificador único del job (ULID), generado por el control-plane. */
  jobId: string;
  userId: string;
  docType: DocType;
  /** Ejercicio fiscal — requerido para IRPF_RENTA. */
  fiscalYear?: number;
}

/** Lo que el worker publica al frontend cuando Cl@ve genera el reto. */
export interface ClaveChallenge {
  /** Código de verificación de 3 letras (modo PIN), si aplica. */
  code?: string;
  /** Imagen del QR como data URL, si aplica. */
  qrDataUrl?: string;
  /** Marca temporal absoluta (epoch ms) de expiración del reto. */
  expiresAt: number;
}

/** Estado vivo del job en el store realtime (DynamoDB / memoria). */
export interface JobState {
  jobId: string;
  status: ExtractionStatus;
  /** Señal frontend → worker: el usuario confirma que validó en su móvil. */
  userConfirmed: boolean;
  /** Solicitud de cancelación. */
  cancelRequested: boolean;
  challenge?: ClaveChallenge;
  /** connectionId del WebSocket asociado (para enrutar push). */
  wsConnectionId?: string;
  /** Token de Step Functions para SendTaskSuccess (modo stepfunctions). */
  taskToken?: string;
  updatedAt: number;
  /** TTL epoch (segundos) para expiración automática en DynamoDB. */
  ttl?: number;
}

/** Eventos que viajan del backend al frontend por WebSocket. */
export type ServerEvent =
  | { type: 'STATUS_CHANGED'; jobId: string; status: ExtractionStatus }
  | { type: 'CODE_READY'; jobId: string; challenge: ClaveChallenge }
  | { type: 'COMPLETED'; jobId: string; downloadUrl?: string }
  | { type: 'FAILED'; jobId: string; errorCode: string; errorMessage: string };

export interface ScrapeResult {
  pdfBuffer: Buffer;
  suggestedFilename: string;
  source: DocSource;
}
