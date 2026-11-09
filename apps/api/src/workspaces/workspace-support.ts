// Small helpers for the workspace routes: slugs and the invitation email.
import { randomBytes } from 'node:crypto';
import type { TransactionalEmail } from '@lead-fennec-ai/integrations';

/**
 * A slug from the workspace name plus 6 random hex characters, e.g. "acme-sales-3f9a1c". The
 * suffix keeps names from colliding and keeps slugs from revealing which names are taken.
 */
export function slugFromName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${base === '' ? 'workspace' : base}-${randomBytes(3).toString('hex')}`;
}

/**
 * The invitation email. The workspace name and the inviter's name are user-supplied: plain text
 * only, and kept out of the subject line.
 */
export function invitationMessage(input: {
  to: string;
  link: string;
  workspaceName: string;
  inviterName: string | null;
  roleName: string;
  validDays: number;
}): TransactionalEmail {
  const inviter = input.inviterName ?? 'A workspace admin';
  return {
    to: input.to,
    template: 'workspace.invitation',
    subject: "You're invited to a workspace on Lead Fennec",
    textBody: `${inviter} invited you to join the workspace "${input.workspaceName}" on Lead Fennec as ${input.roleName}.\n\nAccept the invitation here (sign in, or create an account, with this email address first):\n\n${input.link}\n\nThe link works once and expires in ${String(input.validDays)} days. If you don't know this workspace, ignore this email.\n\nLead Fennec AI`,
  };
}
