import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer = require('nodemailer');
import { renderCodeEmail } from './mail.template';

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: nodemailer.Transporter;
  constructor(private readonly config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASSWORD');
    const localRelay = ['localhost', '127.0.0.1', '::1'].includes(config.get<string>('SMTP_HOST', 'localhost')) && config.get<string>('SMTP_LOCAL_RELAY', 'false') === 'true';
    this.transport = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: Number(config.get<string>('SMTP_PORT', '1025')),
      secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
      requireTLS: config.get<string>('SMTP_REQUIRE_TLS', 'false') === 'true',
      ignoreTLS: localRelay,
      auth: !localRelay && user && pass ? { user, pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
  }

  async sendCode(email: string, code: string, purpose: 'register' | 'reset') {
    return this.deliver(email, renderCodeEmail(code, purpose, this.config.get<string>('WEB_ORIGIN', 'http://localhost:5173')));
  }

  async sendPreview(email: string) {
    return this.deliver(email, renderCodeEmail('381924', 'register', this.config.get<string>('WEB_ORIGIN', 'http://localhost:5173'), true));
  }

  private async deliver(email: string, content: { subject: string; text: string; html: string }) {
    try {
      await this.transport.sendMail({
        from: this.config.get<string>('MAIL_FROM', 'BluviBoard <no-reply@bluviboard.local>'),
        to: email,
        ...content,
      });
    } catch (error) {
      this.logger.error('Email delivery failed', error);
      throw new ServiceUnavailableException('Не удалось отправить письмо. Попробуйте ещё раз немного позже.');
    }
  }

  onModuleDestroy() { this.transport.close(); }
}
