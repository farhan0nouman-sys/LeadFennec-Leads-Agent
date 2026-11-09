// Account emails. Links point at the web app with the token in the URL fragment: browsers
// never send fragments to servers or in Referer headers, so tokens stay out of access logs.
import { AUTH_LINK_PATHS } from '@lead-fennec-ai/shared';
import type { TransactionalEmail } from '@lead-fennec-ai/integrations';

export function tokenLink(
  webAppUrl: string,
  path: (typeof AUTH_LINK_PATHS)[keyof typeof AUTH_LINK_PATHS],
  token: string,
): string {
  return `${webAppUrl}${path}#token=${token}`;
}

const SIGNATURE = '\n\nLead Fennec AI';
const NOT_YOU =
  "If you didn't ask for this, you can ignore this email; nothing changes until the link is used.";

export function verifyEmailMessage(
  to: string,
  link: string,
  validHours: number,
): TransactionalEmail {
  return {
    to,
    template: 'auth.verify_email',
    subject: 'Confirm your email address',
    textBody: `Confirm your email address to finish creating your Lead Fennec account:\n\n${link}\n\nThe link works once and expires in ${String(validHours)} hours. ${NOT_YOU}${SIGNATURE}`,
  };
}

/** Someone registered an address whose account is not verified yet: let the owner choose the password. */
export function finishSetupMessage(
  to: string,
  link: string,
  validMinutes: number,
): TransactionalEmail {
  return {
    to,
    template: 'auth.finish_setup',
    subject: 'Finish setting up your account',
    textBody: `Someone asked to create a Lead Fennec account with this address. To finish, choose your password here:\n\n${link}\n\nThe link works once and expires in ${String(validMinutes)} minutes. Earlier confirmation links no longer work. ${NOT_YOU}${SIGNATURE}`,
  };
}

/** Someone registered an address that already has a verified account. */
export function alreadyRegisteredMessage(
  to: string,
  webAppUrl: string,
): TransactionalEmail {
  return {
    to,
    template: 'auth.already_registered',
    subject: 'You already have an account',
    textBody: `Someone tried to create a Lead Fennec account with this address, which already has one. Sign in at ${webAppUrl}/login, or reset your password at ${webAppUrl}/forgot-password. ${NOT_YOU}${SIGNATURE}`,
  };
}

export function passwordResetMessage(
  to: string,
  link: string,
  validMinutes: number,
): TransactionalEmail {
  return {
    to,
    template: 'auth.password_reset',
    subject: 'Reset your password',
    textBody: `Choose a new password for your Lead Fennec account:\n\n${link}\n\nThe link works once and expires in ${String(validMinutes)} minutes. ${NOT_YOU}${SIGNATURE}`,
  };
}

export function passwordChangedMessage(
  to: string,
  webAppUrl: string,
): TransactionalEmail {
  return {
    to,
    template: 'auth.password_changed',
    subject: 'Your password was changed',
    textBody: `The password of your Lead Fennec account was just changed, and every signed-in session was ended. If this wasn't you, reset your password now at ${webAppUrl}/forgot-password.${SIGNATURE}`,
  };
}
