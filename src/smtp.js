import SMTPConnection from 'nodemailer/lib/smtp-connection/index.js';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
export function createMailer(options) {
  return {
    send(mail, { signal } = {}) {
      return new Promise(resolve => {
        const connection = new SMTPConnection({ ...options, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, logger: false, debug: false });
        let done = false, dataStarted = false;
        const finish = result => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); connection.close(); resolve(result); };
        const abort = () => finish({ status: 'unknown', error_code: 'SMTP_DEADLINE' });
        const timer = setTimeout(() => finish({ status: 'unknown', error_code: 'SMTP_DEADLINE' }), options.deadlineMs || 15000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        const failed = error => {
          const rejected = Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599;
          finish({ status: rejected || !dataStarted ? 'failed' : 'unknown', error_code: rejected ? 'SMTP_REJECTED' : !dataStarted ? 'SMTP_NOT_SUBMITTED' : 'SMTP_UNCERTAIN' });
        };
        connection.on('error', failed);
        connection.on('end', () => { if (!done) failed(); });
        const composer = new MailComposer({ from: { name: mail.fromName, address: options.from }, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: mail.replyTo, disableFileAccess: true, disableUrlAccess: true }).compile();
        composer.build((error, message) => {
          if (done) return; if (error) return failed(error);
          connection.connect(error => {
            if (done) return; if (error) return failed(error);
            const send = error => {
              if (done) return; if (error) return failed(error);
              dataStarted = true;
              connection.send(composer.getEnvelope(), message, (error, info) => {
                if (error) return failed(error);
                finish({ status: info.accepted?.length === 1 ? 'accepted' : 'failed', messageId: composer.messageId() });
              });
            };
            if (options.auth) connection.login(options.auth, send); else send();
          });
        });
      });
    },
  };
}
