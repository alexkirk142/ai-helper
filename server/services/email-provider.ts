/**
 * Email Provider Abstraction
 * 
 * SECURITY CONSIDERATIONS:
 * - Never log actual tokens in production
 * - Emails may be delayed/lost - users can request new tokens
 * - Links should use HTTPS in production
 * 
 * DEV MODE: Console logger (no actual emails sent)
 * PRODUCTION: Replace with real email provider (SendGrid, Resend, etc.)
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

/**
 * Console Email Provider (Development)
 * Logs emails to console instead of sending.
 */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<{ success: boolean; messageId?: string }> {
    const messageId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    console.log("\n" + "=".repeat(60));
    console.log("[EMAIL] Development Mode - Email would be sent:");
    console.log("=".repeat(60));
    console.log(`To: ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log("-".repeat(60));
    console.log(message.text);
    console.log("=".repeat(60) + "\n");
    
    return { success: true, messageId };
  }
}

/**
 * Get configured email provider.
 * Uses ConsoleEmailProvider in development.
 */
export function getEmailProvider(): EmailProvider {
  // In production, check for SMTP/API credentials and return appropriate provider
  // For now, always use console provider
  return new ConsoleEmailProvider();
}

/**
 * Email templates for auth flows.
 */
export const emailTemplates = {
  /**
   * Email verification template.
   * @param username User's display name
   * @param verifyUrl Full URL with token
   */
  verification(username: string, verifyUrl: string): EmailMessage {
    return {
      to: "", // Set by caller
      subject: "Подтвердите ваш email - AI Sales Operator",
      text: `Здравствуйте, ${username}!

Для подтверждения вашего email перейдите по ссылке:
${verifyUrl}

Ссылка действительна 24 часа.

Если вы не регистрировались на нашем сервисе, проигнорируйте это письмо.

С уважением,
Команда AI Sales Operator`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Здравствуйте, ${username}!</h2>
          <p>Для подтверждения вашего email нажмите на кнопку ниже:</p>
          <p style="margin: 30px 0;">
            <a href="${verifyUrl}" 
               style="background: #2563eb; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Подтвердить email
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            Или скопируйте ссылку: <br/>
            <a href="${verifyUrl}" style="color: #2563eb;">${verifyUrl}</a>
          </p>
          <p style="color: #666; font-size: 14px;">Ссылка действительна 24 часа.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px;">
            Если вы не регистрировались на нашем сервисе, проигнорируйте это письмо.
          </p>
        </div>
      `,
    };
  },

  /**
   * Password reset template.
   * SECURITY: Don't reveal if email exists
   * @param username User's display name
   * @param resetUrl Full URL with token
   */
  passwordReset(username: string, resetUrl: string): EmailMessage {
    return {
      to: "", // Set by caller
      subject: "Сброс пароля - AI Sales Operator",
      text: `Здравствуйте, ${username}!

Вы запросили сброс пароля. Перейдите по ссылке для создания нового пароля:
${resetUrl}

Ссылка действительна 1 час.

Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
Ваш пароль останется без изменений.

С уважением,
Команда AI Sales Operator`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Здравствуйте, ${username}!</h2>
          <p>Вы запросили сброс пароля. Нажмите на кнопку ниже для создания нового пароля:</p>
          <p style="margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background: #2563eb; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Сбросить пароль
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            Или скопируйте ссылку: <br/>
            <a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a>
          </p>
          <p style="color: #666; font-size: 14px;">Ссылка действительна 1 час.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px;">
            Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
            Ваш пароль останется без изменений.
          </p>
        </div>
      `,
    };
  },
};

export const emailProvider = getEmailProvider();
