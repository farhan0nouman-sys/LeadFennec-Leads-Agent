'use client';

// Stages 5–8 of the campaign setup wizard (task 06B): mailbox, sequence, schedule and review.
// Connecting mailboxes, writing the emails and starting a campaign aren't built yet: those parts
// say so, and nothing here claims a connection or a send that didn't happen.
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  ChoiceGroup,
  CheckboxField,
  FormField,
  SelectField,
  TextareaField,
} from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  HALF_HOURS,
  mailboxForm,
  reviewForm,
  scheduleForm,
  sequenceForm,
  stageState,
  timeLabel,
  WEEKDAYS,
  WIZARD_STAGES,
  type StageKey,
  type StepValues,
} from '@/lib/campaign-wizard';
import { ActivationPanel } from './activation-panel';
import {
  NotAvailableNotice,
  StageFrame,
  useStageForm,
  type StageContext,
} from './stage-frame';

interface StageProps {
  readonly context: StageContext;
}

const PROVIDER_LABELS = {
  GMAIL: 'Gmail',
  MICROSOFT_GRAPH: 'Microsoft 365',
} as const;

const MAX_STEPS = 10;

export function MailboxStage({ context }: StageProps) {
  const form = useStageForm(mailboxForm, context);
  const { values, set, errors } = form;
  const mailboxes = context.options.data?.mailboxes;
  const stored = values.emailAccountId;
  const storedKnown =
    stored === '' || (mailboxes?.some((m) => m.id === stored) ?? true);
  return (
    <StageFrame context={context} form={form}>
      <NotAvailableNotice title="Connecting a mailbox">
        <p>
          Lead Fennec can&apos;t connect to Gmail or Microsoft 365 yet, so this
          campaign can&apos;t send email. You can finish the other steps now and
          choose a mailbox here once connecting is available.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled>
            Connect Gmail
          </Button>
          <Button type="button" variant="outline" size="sm" disabled>
            Connect Microsoft 365
          </Button>
        </div>
      </NotAvailableNotice>
      {mailboxes === undefined ? (
        <p className="text-sm text-muted-foreground">
          Loading the mailboxes of this workspace…
        </p>
      ) : mailboxes.length === 0 && storedKnown ? (
        <EmptyState
          title="No mailboxes in this workspace"
          description="Once connecting is available, the mailboxes you connect will be listed here."
        />
      ) : (
        <ChoiceGroup
          legend="Send from"
          hint="Mailboxes already in this workspace. A mailbox can send only when its status is Connected."
          error={errors['emailAccountId']}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="emailAccountId"
              value=""
              checked={stored === ''}
              onChange={() => {
                set('emailAccountId', '');
              }}
              className="size-4 accent-primary"
            />
            No mailbox yet
          </label>
          {mailboxes.map((mailbox) => (
            <label
              key={mailbox.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            >
              <input
                type="radio"
                name="emailAccountId"
                value={mailbox.id}
                checked={stored === mailbox.id}
                onChange={() => {
                  set('emailAccountId', mailbox.id);
                }}
                className="size-4 accent-primary"
              />
              <span className="font-medium break-all">{mailbox.email}</span>
              <span className="text-muted-foreground">
                {PROVIDER_LABELS[mailbox.provider]}
              </span>
              <Status kind="mailbox" value={mailbox.status} />
            </label>
          ))}
          {storedKnown ? null : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="emailAccountId"
                value={stored}
                checked
                readOnly
                className="size-4 accent-primary"
              />
              A mailbox that is no longer connected
            </label>
          )}
        </ChoiceGroup>
      )}
    </StageFrame>
  );
}

function StepEditor({
  index,
  step,
  count,
  templates,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  readonly index: number;
  readonly step: StepValues;
  readonly count: number;
  readonly templates:
    readonly { readonly id: string; readonly name: string }[] | undefined;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (step: StepValues) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const number = index + 1;
  const knownTemplate =
    step.templateId === '' ||
    (templates?.some((t) => t.id === step.templateId) ?? true);
  return (
    <fieldset className="grid min-w-0 gap-4 rounded-xl border p-4">
      <legend className="px-1 text-base font-semibold">
        Step {String(number)}
      </legend>
      <ChoiceGroup
        legend={
          index === 0
            ? 'Wait after the lead joins the campaign'
            : `Wait after step ${String(index)} is sent`
        }
        error={errors[`steps.${String(index)}.delay`]}
        className="grid gap-2"
      >
        <div className="flex flex-wrap gap-3">
          <div className="w-28">
            <FormField
              label="Days"
              type="number"
              inputMode="numeric"
              min={0}
              value={step.days}
              onChange={(event) => {
                onChange({ ...step, days: event.target.value });
              }}
            />
          </div>
          <div className="w-28">
            <FormField
              label="Hours"
              type="number"
              inputMode="decimal"
              min={0}
              value={step.hours}
              onChange={(event) => {
                onChange({ ...step, hours: event.target.value });
              }}
            />
          </div>
        </div>
      </ChoiceGroup>
      {templates === undefined || (templates.length === 0 && knownTemplate) ? (
        <p className="text-sm text-muted-foreground">
          {templates === undefined
            ? 'Loading the templates of this workspace…'
            : 'There are no templates in this workspace yet, so this step has no content.'}
        </p>
      ) : (
        <SelectField
          label="Template"
          value={step.templateId}
          error={errors[`steps.${String(index)}.template`]}
          onChange={(event) => {
            onChange({ ...step, templateId: event.target.value });
          }}
        >
          <option value="">No template yet</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
          {knownTemplate ? null : (
            <option value={step.templateId}>
              A template that is no longer available
            </option>
          )}
        </SelectField>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={index === 0}
          aria-label={`Move up step ${String(number)}`}
          onClick={() => {
            onMove(-1);
          }}
        >
          <ArrowUp aria-hidden="true" />
          Move up
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={index === count - 1}
          aria-label={`Move down step ${String(number)}`}
          onClick={() => {
            onMove(1);
          }}
        >
          <ArrowDown aria-hidden="true" />
          Move down
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Remove step ${String(number)}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      </div>
    </fieldset>
  );
}

export function SequenceStage({ context }: StageProps) {
  const form = useStageForm(sequenceForm, context);
  const { values, set, errors } = form;
  const templates = context.options.data?.templates;
  const added = useRef(0);
  const steps = values.steps;
  const replace = (next: readonly StepValues[]) => {
    set('steps', next);
  };
  return (
    <StageFrame context={context} form={form}>
      <NotAvailableNotice title="Writing the emails">
        <p>
          Writing or generating the messages isn&apos;t available yet. For now,
          each step saves when it is sent and, if your workspace has templates,
          which template it uses. Nothing is sent until sending is available.
        </p>
      </NotAvailableNotice>
      {steps.length === 0 ? (
        <EmptyState
          title="No steps yet"
          description="Add the first email of the sequence. At least one step is needed before the campaign can start."
        />
      ) : (
        <ol className="grid gap-4" aria-label="Steps">
          {steps.map((step, index) => (
            <li key={step.key}>
              <StepEditor
                index={index}
                step={step}
                count={steps.length}
                templates={templates}
                errors={errors}
                onChange={(changed) => {
                  replace(steps.map((s, i) => (i === index ? changed : s)));
                }}
                onMove={(by) => {
                  const next = [...steps];
                  const [moved] = next.splice(index, 1);
                  if (moved !== undefined) {
                    next.splice(index + by, 0, moved);
                    replace(next);
                  }
                }}
                onRemove={() => {
                  replace(steps.filter((_, i) => i !== index));
                }}
              />
            </li>
          ))}
        </ol>
      )}
      {errors['steps'] === undefined ? null : (
        <p className="text-sm text-destructive">{errors['steps']}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={steps.length >= MAX_STEPS}
          onClick={() => {
            added.current += 1;
            replace([
              ...steps,
              {
                key: `new-${String(added.current)}`,
                days: steps.length === 0 ? '0' : '3',
                hours: '0',
                templateId: '',
              },
            ]);
          }}
        >
          <Plus aria-hidden="true" />
          Add step
        </Button>
        <span className="text-sm text-muted-foreground">
          {steps.length >= MAX_STEPS
            ? 'A sequence has at most 10 steps.'
            : `Up to ${String(MAX_STEPS)} steps.`}
        </span>
      </div>
    </StageFrame>
  );
}

/** The browser's time zones, with UTC and the stored one always present. */
function timeZones(current: string): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older browsers: the stored zone and UTC still work.
    zones = [];
  }
  return [...new Set(['UTC', current, ...zones])].sort((a, b) =>
    a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b),
  );
}

export function ScheduleStage({ context }: StageProps) {
  const form = useStageForm(scheduleForm, context);
  const { values, set, errors } = form;
  const chosen = new Set(values.weekdays);
  const starts = HALF_HOURS.filter((m) => m < 1440);
  const ends = HALF_HOURS.filter((m) => m > 0);
  const withCurrent = (list: readonly number[], current: string) =>
    [...new Set([...list, Number(current)])].sort((a, b) => a - b);
  return (
    <StageFrame context={context} form={form}>
      <SelectField
        label="Time zone"
        name="timezone"
        hint="Emails go out at these times in this time zone."
        value={values.timezone}
        error={errors['timezone']}
        onChange={(event) => {
          set('timezone', event.target.value);
        }}
      >
        {timeZones(values.timezone).map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll('_', ' ')}
          </option>
        ))}
      </SelectField>
      <ChoiceGroup
        legend="Days to send on"
        error={errors['weekdays']}
        className="grid gap-2"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WEEKDAYS.map((day) => (
            <CheckboxField
              key={day.value}
              label={day.label}
              checked={chosen.has(day.value)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) {
                  next.add(day.value);
                } else {
                  next.delete(day.value);
                }
                set(
                  'weekdays',
                  [...next].sort((a, b) => a - b),
                );
              }}
            />
          ))}
        </div>
      </ChoiceGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Start sending at"
          name="windowStartMinute"
          value={values.windowStartMinute}
          error={errors['windowStartMinute']}
          onChange={(event) => {
            set('windowStartMinute', event.target.value);
          }}
        >
          {withCurrent(starts, values.windowStartMinute).map((m) => (
            <option key={m} value={String(m)}>
              {timeLabel(m)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Stop sending at"
          name="windowEndMinute"
          value={values.windowEndMinute}
          error={errors['windowEndMinute']}
          onChange={(event) => {
            set('windowEndMinute', event.target.value);
          }}
        >
          {withCurrent(ends, values.windowEndMinute).map((m) => (
            <option key={m} value={String(m)}>
              {timeLabel(m)}
            </option>
          ))}
        </SelectField>
      </div>
    </StageFrame>
  );
}

/** One line about what a stage holds now. */
function summaryOf(stage: StageKey, context: StageContext): string {
  const { campaign } = context;
  const choices = context.options.data;
  const nameOf = (
    list: readonly { readonly id: string; readonly name: string }[] | undefined,
    id: string | null,
  ) =>
    id === null
      ? null
      : (list?.find((item) => item.id === id)?.name ??
        'One that is no longer available');
  switch (stage) {
    case 'business-profile':
      return campaign.businessProfile?.companyName ?? 'Not filled in yet';
    case 'audience': {
      const parts = [
        nameOf(choices?.icps, campaign.audience.icpId),
        nameOf(choices?.leadLists, campaign.audience.leadListId),
      ].filter((part) => part !== null);
      return parts.length === 0
        ? 'No profile or lead list yet'
        : parts.join(' · ');
    }
    case 'offer':
      return campaign.offer?.name ?? 'Not filled in yet';
    case 'filters': {
      const { dailyNewLeads, maxLeads } = campaign.leadLimits;
      return dailyNewLeads === null || maxLeads === null
        ? 'Lead numbers not set yet'
        : `${String(dailyNewLeads)} new leads a day, ${String(maxLeads)} in total`;
    }
    case 'mailbox': {
      const id = campaign.sender.emailAccountId;
      if (id === null) {
        return "No mailbox yet (connecting isn't available yet)";
      }
      return (
        choices?.mailboxes.find((m) => m.id === id)?.email ??
        'A mailbox that is no longer connected'
      );
    }
    case 'sequence': {
      const count = campaign.sequence.steps.length;
      return count === 0
        ? 'No steps yet'
        : `${String(count)} ${count === 1 ? 'step' : 'steps'}`;
    }
    case 'schedule': {
      const days = campaign.schedule.weekdays
        .map((d) => WEEKDAYS.find((w) => w.value === d)?.label.slice(0, 3))
        .join(', ');
      return `${days}, ${timeLabel(campaign.schedule.windowStartMinute)}–${timeLabel(
        campaign.schedule.windowEndMinute,
      )}, ${campaign.timezone.replaceAll('_', ' ')}`;
    }
    case 'review':
      return '';
  }
}

export function ReviewStage({ context }: StageProps) {
  const form = useStageForm(reviewForm, context);
  const { values, set, errors } = form;
  const { campaign } = context;
  return (
    <StageFrame context={context} form={form}>
      <FormField
        label="Campaign name"
        name="name"
        hint="Up to 120 characters."
        value={values.name}
        error={errors['name']}
        onChange={(event) => {
          set('name', event.target.value);
        }}
      />
      <TextareaField
        label="Description (optional)"
        name="description"
        rows={2}
        hint="For your team only. Up to 2,000 characters."
        value={values.description}
        error={errors['description']}
        onChange={(event) => {
          set('description', event.target.value);
        }}
      />
      <dl className="grid gap-0 divide-y rounded-xl border">
        {WIZARD_STAGES.filter((stage) => stage.key !== 'review').map(
          (stage) => {
            const done = stageState(stage, campaign) === 'done';
            return (
              <div
                key={stage.key}
                data-stage={stage.key}
                // dt and its dd elements directly inside the group (valid list structure).
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-0.5 p-3"
              >
                <dt className="font-medium">
                  {stage.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {done ? 'Done' : 'Not done yet'}
                  </span>
                </dt>
                <dd className="text-sm break-words text-muted-foreground">
                  {summaryOf(stage.key, context)}
                </dd>
                <dd className="col-start-2 row-span-2 row-start-1">
                  <Link
                    href={context.hrefOf(stage.key)}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    onClick={(event) => {
                      event.preventDefault();
                      void form.save().then((outcome) => {
                        if (outcome === 'saved' || outcome === 'unchanged') {
                          context.go(stage.key);
                        }
                      });
                    }}
                  >
                    Edit<span className="sr-only"> {stage.label}</span>
                  </Link>
                </dd>
              </div>
            );
          },
        )}
        <div className="grid gap-0.5 p-3">
          <dt className="font-medium">Approval</dt>
          <dd className="text-sm text-muted-foreground">
            {campaign.approvalMode === 'HUMAN'
              ? 'A person approves every email before it is sent.'
              : 'Emails that pass the checks are approved without a person.'}
          </dd>
        </div>
      </dl>
      <ActivationPanel
        context={context}
        dirty={form.dirty}
        onFix={(stage) => {
          void form.save().then((outcome) => {
            if (outcome === 'saved' || outcome === 'unchanged') {
              context.go(stage);
            }
          });
        }}
      />
    </StageFrame>
  );
}
