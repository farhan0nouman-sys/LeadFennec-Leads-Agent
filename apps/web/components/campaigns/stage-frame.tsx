'use client';

// One stage of the campaign setup wizard (task 06B, docs/decisions.md D-06B-*): the list of
// stages, the stage's form and its buttons. Saving checks the stage with the API's own schema
// first and maps any issue (the page's or the API's) to its field. Moving to another stage saves
// the current one first; an invalid stage stays, with focus on its first problem.
import {
  API,
  type Campaign,
  type CampaignOptions,
} from '@lead-fennec-ai/shared';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FormError } from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import {
  checkSave,
  isDirty,
  mapIssues,
  stageIndex,
  stageState,
  WIZARD_STAGES,
  type Issue,
  type StageForm,
  type StageKey,
} from '@/lib/campaign-wizard';
import { useApiMutation, type QueryResult } from '@/lib/query';
import { cn } from '@/lib/utils';

/** What every stage gets from the wizard. */
export interface StageContext {
  readonly workspaceId: string;
  readonly campaign: Campaign;
  readonly options: QueryResult<CampaignOptions>;
  /** A draft and a member who may change campaigns. */
  readonly editable: boolean;
  readonly stage: StageKey;
  /** The stage was reached from another one (move focus to its heading). */
  readonly arrived: boolean;
  readonly hrefOf: (stage: StageKey) => string;
  readonly go: (stage: StageKey) => void;
  readonly onSaved: (campaign: Campaign) => void;
  readonly onConflict: () => void;
}

export type SaveOutcome = 'saved' | 'unchanged' | 'invalid' | 'failed';

const NOT_SAVED =
  'Check the highlighted fields. Nothing on this step was saved.';

/** The values of one stage's form, its errors, and saving. */
export function useStageForm<V>(form: StageForm<V>, context: StageContext) {
  const { campaign, editable } = context;
  const [values, setValues] = useState<V>(() => form.initial(campaign));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Raised by each refused save, so the frame moves focus to the first problem. */
  const [refusals, setRefusals] = useState(0);
  const update = useApiMutation(API.campaigns.update);
  const dirty = editable && isDirty(form, values, campaign);

  const refuse = (issues: readonly Issue[]) => {
    const mapped = mapIssues(form.rules, issues);
    setErrors(mapped.fields);
    setFormError(
      mapped.other.length > 0
        ? mapped.other.join(' ')
        : Object.keys(mapped.fields).length > 0
          ? NOT_SAVED
          : 'Something went wrong. Try again.',
    );
    setRefusals((n) => n + 1);
  };

  async function save(): Promise<SaveOutcome> {
    if (!dirty) {
      return 'unchanged';
    }
    setFormError(null);
    const checked = checkSave(
      campaign.version,
      form.toChange(values, campaign),
    );
    if (!checked.ok) {
      refuse(checked.issues);
      return 'invalid';
    }
    const result = await update.mutate({
      params: { workspaceId: context.workspaceId, campaignId: campaign.id },
      body: checked.body,
    });
    if (result.ok) {
      setErrors({});
      context.onSaved(result.data);
      return 'saved';
    }
    if (result.signedOut) {
      return 'failed';
    }
    if (
      result.error.code === 'validation_failed' &&
      result.error.issues.length > 0
    ) {
      refuse(result.error.issues);
      return 'invalid';
    }
    if (result.error.code === 'version_conflict') {
      context.onConflict();
      return 'failed';
    }
    setFormError(errorMessage(result.error));
    return 'failed';
  }

  return {
    values,
    /** Changes one value; its error stays until the next save. */
    set: <K extends keyof V>(key: K, value: V[K]) => {
      setValues((before) => ({ ...before, [key]: value }));
    },
    setValues,
    errors,
    formError,
    refusals,
    dirty,
    pending: update.pending,
    save,
  };
}

export type StageFormState = ReturnType<typeof useStageForm>;

/** The ordered list of stages; each one says whether it is done. */
function StageList({
  context,
  onSelect,
}: {
  readonly context: StageContext;
  readonly onSelect: (stage: StageKey) => void;
}) {
  return (
    <nav aria-label="Campaign setup steps">
      <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
        {WIZARD_STAGES.map((stage, index) => {
          const current = stage.key === context.stage;
          const done = stageState(stage, context.campaign) === 'done';
          return (
            <li key={stage.key}>
              <Link
                href={context.hrefOf(stage.key)}
                aria-current={current ? 'step' : undefined}
                data-state={done ? 'done' : 'todo'}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) {
                    return;
                  }
                  event.preventDefault();
                  onSelect(stage.key);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  current && 'bg-accent font-medium',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                    done && 'border-success bg-success text-white',
                  )}
                >
                  {done ? (
                    <Check className="size-3" />
                  ) : (
                    <span>{String(index + 1)}</span>
                  )}
                </span>
                {/* Named by its content (the number is decorative): "Offer, not done yet". */}
                <span className="min-w-0 truncate">{stage.label}</span>
                <span className="sr-only">
                  {done ? ', done' : ', not done yet'}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The frame of a stage: the stage list, the heading, the form (disabled when the campaign can't
 * be changed) and Back, Save draft and Save and continue.
 */
export function StageFrame({
  context,
  form,
  children,
}: {
  readonly context: StageContext;
  readonly form: Pick<
    StageFormState,
    'dirty' | 'pending' | 'save' | 'formError' | 'refusals'
  >;
  readonly children: ReactNode;
}) {
  const index = stageIndex(context.stage);
  const stage = WIZARD_STAGES[index] ?? WIZARD_STAGES[0];
  const previous = WIZARD_STAGES[index - 1];
  const next = WIZARD_STAGES[index + 1];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, refusals } = form;

  useEffect(() => {
    if (context.arrived) {
      headingRef.current?.focus();
    }
  }, [context.arrived]);

  // After a refused save, focus goes to the first field with a problem.
  useEffect(() => {
    if (refusals === 0) {
      return;
    }
    formRef.current
      ?.querySelector<HTMLElement>(
        '[aria-invalid="true"], fieldset[data-invalid] input, fieldset[data-invalid] select',
      )
      ?.focus();
  }, [refusals]);

  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  /** Saves what changed, then moves; an invalid or failed save stays. */
  async function goTo(target: StageKey): Promise<void> {
    if (target === context.stage) {
      return;
    }
    if (context.editable) {
      const outcome = await form.save();
      if (outcome === 'invalid' || outcome === 'failed') {
        return;
      }
    }
    context.go(target);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <StageList
        context={context}
        onSelect={(target) => {
          void goTo(target);
        }}
      />
      <section aria-labelledby="stage-heading" className="grid min-w-0 gap-5">
        <div className="grid gap-1">
          <p className="text-sm text-muted-foreground">
            Step {String(index + 1)} of {String(WIZARD_STAGES.length)}:{' '}
            {stage.label}
          </p>
          <h2
            id="stage-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            {stage.title}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {stage.description}
          </p>
        </div>
        <FormError message={form.formError} />
        <form
          ref={formRef}
          noValidate
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void (next === undefined ? form.save() : goTo(next.key));
          }}
        >
          <fieldset
            disabled={!context.editable || form.pending}
            className="grid min-w-0 gap-5"
          >
            {children}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {previous === undefined ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={form.pending}
                onClick={() => {
                  void goTo(previous.key);
                }}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
            )}
            {context.editable ? (
              <Button
                type="button"
                variant="outline"
                disabled={form.pending}
                onClick={() => {
                  void form.save();
                }}
              >
                {form.pending ? 'Saving…' : 'Save draft'}
              </Button>
            ) : null}
            {next === undefined ? null : (
              <Button
                type="submit"
                className="sm:ml-auto"
                disabled={form.pending}
              >
                {context.editable ? 'Save and continue' : 'Next'}
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

/** A notice that a feature of this stage isn't built yet; never a fake success. */
export function NotAvailableNotice({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Alert data-slot="not-available" className="border-dashed">
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {title}
        <Badge variant="outline">Not available yet</Badge>
      </AlertTitle>
      <AlertDescription className="grid gap-2">{children}</AlertDescription>
    </Alert>
  );
}
