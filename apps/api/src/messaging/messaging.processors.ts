import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MessagingService } from './messaging.service';
import {
  INCOMING_QUEUE,
  OUTGOING_QUEUE,
  RESPOND_QUEUE,
  type OutgoingJob,
  type RespondJob,
} from './queues';

/** Procesa cada webhook entrante: guarda el mensaje y dispara la respuesta IA. */
@Processor(INCOMING_QUEUE)
export class IncomingProcessor extends WorkerHost {
  private readonly logger = new Logger(IncomingProcessor.name);

  constructor(private readonly messaging: MessagingService) {
    super();
  }

  async process(job: Job<Record<string, unknown>>): Promise<void> {
    await this.messaging.handleIncoming(job.data);
  }
}

/** Envía los mensajes proactivos (primer contacto), con throttling. */
@Processor(OUTGOING_QUEUE)
export class OutgoingProcessor extends WorkerHost {
  private readonly logger = new Logger(OutgoingProcessor.name);

  constructor(private readonly messaging: MessagingService) {
    super();
  }

  async process(job: Job<OutgoingJob>): Promise<void> {
    await this.messaging.deliverOutgoing(job.data);
  }
}

/**
 * Genera y envía la respuesta agrupada (debounced) de una conversación. Hay como
 * mucho un job por conversación; si llega un mensaje nuevo, se reprograma.
 */
@Processor(RESPOND_QUEUE)
export class RespondProcessor extends WorkerHost {
  private readonly logger = new Logger(RespondProcessor.name);

  constructor(private readonly messaging: MessagingService) {
    super();
  }

  async process(job: Job<RespondJob>): Promise<void> {
    await this.messaging.generateAndSend(job.data);
  }
}
