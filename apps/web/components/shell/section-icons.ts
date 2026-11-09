import {
  Ban,
  Building2,
  ChartLine,
  ClipboardCheck,
  CreditCard,
  Inbox,
  Layers,
  LayoutDashboard,
  ListChecks,
  Mail,
  Plug,
  ScrollText,
  Send,
  Settings,
  Target,
  Upload,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Icons of the sections in packages/shared/src/navigation.ts. Decorative only. */
export const SECTION_ICONS: Readonly<Record<string, LucideIcon>> = {
  overview: LayoutDashboard,
  icps: Target,
  leads: Users,
  lead_lists: ListChecks,
  imports: Upload,
  campaigns: Send,
  approvals: ClipboardCheck,
  inbox: Inbox,
  automations: Workflow,
  analytics: ChartLine,
  team: UsersRound,
  integrations: Plug,
  mailboxes: Mail,
  suppressions: Ban,
  billing: CreditCard,
  audit: ScrollText,
  settings: Settings,
  // Admin area
  workspaces: Building2,
  users: Users,
  plans: Layers,
  platform_audit: ScrollText,
};

export const iconFor = (key: string): LucideIcon =>
  SECTION_ICONS[key] ?? LayoutDashboard;
