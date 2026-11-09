'use client';

// Stages 1–4 of the campaign setup wizard (task 06B): business profile, target audience, offer
// and lead filters. Every field may stay blank in a draft; values must be within the shared
// bounds, and messages appear next to their field.
import { RetryState } from '@/components/feedback/retry-state';
import {
  CheckboxField,
  ChoiceGroup,
  FormField,
  SelectField,
  TextareaField,
} from '@/components/form-field';
import {
  audienceForm,
  businessProfileForm,
  filtersForm,
  offerForm,
} from '@/lib/campaign-wizard';
import { StageFrame, useStageForm, type StageContext } from './stage-frame';

interface StageProps {
  readonly context: StageContext;
}

/** Why a draft can be saved without something that is still needed to start. */
function NeededToStart({ children }: { readonly children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** The workspace's choices, while loading, or why they can't be shown. */
function ChoicesProblem({ context }: StageProps) {
  const { options } = context;
  return options.status === 'error' ? (
    <RetryState
      title="We couldn't load your lead lists, profiles and mailboxes"
      error={options.error}
      onRetry={options.retry}
    />
  ) : null;
}

export function BusinessProfileStage({ context }: StageProps) {
  const form = useStageForm(businessProfileForm, context);
  const { values, set, errors } = form;
  return (
    <StageFrame context={context} form={form}>
      <FormField
        label="Company name"
        name="companyName"
        autoComplete="organization"
        hint="As your prospects know it. Up to 200 characters."
        value={values.companyName}
        error={errors['companyName']}
        onChange={(event) => {
          set('companyName', event.target.value);
        }}
      />
      <FormField
        label="Website"
        name="website"
        inputMode="url"
        autoComplete="url"
        placeholder="https://www.example.com"
        hint="Starts with http:// or https://."
        value={values.website}
        error={errors['website']}
        onChange={(event) => {
          set('website', event.target.value);
        }}
      />
      <TextareaField
        label="What your company does"
        name="description"
        rows={4}
        hint="A few sentences. Up to 2,000 characters."
        value={values.description}
        error={errors['description']}
        onChange={(event) => {
          set('description', event.target.value);
        }}
      />
      <TextareaField
        label="Why customers choose you (optional)"
        name="valueProposition"
        rows={3}
        hint="Up to 2,000 characters."
        value={values.valueProposition}
        error={errors['valueProposition']}
        onChange={(event) => {
          set('valueProposition', event.target.value);
        }}
      />
      <NeededToStart>
        The company name and what your company does are needed before the
        campaign can start. You can save this step without them.
      </NeededToStart>
    </StageFrame>
  );
}

/** Options for a stored reference, including one that is no longer offered. */
function choiceOptions(
  choices:
    readonly { readonly id: string; readonly name: string }[] | undefined,
  stored: string,
  missingLabel: string,
) {
  const known = choices?.some((choice) => choice.id === stored) ?? false;
  return (
    <>
      {(choices ?? []).map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.name}
        </option>
      ))}
      {stored !== '' && !known && choices !== undefined ? (
        <option value={stored}>{missingLabel}</option>
      ) : null}
    </>
  );
}

export function AudienceStage({ context }: StageProps) {
  const form = useStageForm(audienceForm, context);
  const { values, set, errors } = form;
  const choices = context.options.data;
  const loading = choices === undefined;
  return (
    <StageFrame context={context} form={form}>
      <ChoicesProblem context={context} />
      <SelectField
        label="Ideal customer profile"
        name="icpId"
        disabled={loading}
        hint={
          choices?.icps.length === 0
            ? "There are no ideal customer profiles in this workspace yet. Creating them isn't available yet."
            : 'The kind of company and person this campaign is for.'
        }
        value={values.icpId}
        error={errors['icpId']}
        onChange={(event) => {
          set('icpId', event.target.value);
        }}
      >
        <option value="">{loading ? 'Loading choices…' : 'None'}</option>
        {choiceOptions(
          choices?.icps,
          values.icpId,
          'A profile that is no longer available',
        )}
      </SelectField>
      <SelectField
        label="Lead list"
        name="leadListId"
        disabled={loading}
        hint={
          choices?.leadLists.length === 0
            ? "There are no lead lists in this workspace yet. Creating them isn't available yet."
            : 'The people this campaign contacts.'
        }
        value={values.leadListId}
        error={errors['leadListId']}
        onChange={(event) => {
          set('leadListId', event.target.value);
        }}
      >
        <option value="">{loading ? 'Loading choices…' : 'None'}</option>
        {choiceOptions(
          choices?.leadLists,
          values.leadListId,
          'A lead list that is no longer available',
        )}
      </SelectField>
      <NeededToStart>
        A profile or a lead list is needed before the campaign can start. You
        can narrow the audience further under Lead filters.
      </NeededToStart>
    </StageFrame>
  );
}

export function OfferStage({ context }: StageProps) {
  const form = useStageForm(offerForm, context);
  const { values, set, errors } = form;
  return (
    <StageFrame context={context} form={form}>
      <FormField
        label="Offer"
        name="name"
        hint="A short name, such as “Free pipeline audit”. Up to 200 characters."
        value={values.name}
        error={errors['name']}
        onChange={(event) => {
          set('name', event.target.value);
        }}
      />
      <TextareaField
        label="What the offer includes"
        name="description"
        rows={4}
        hint="Up to 2,000 characters."
        value={values.description}
        error={errors['description']}
        onChange={(event) => {
          set('description', event.target.value);
        }}
      />
      <FormField
        label="What you ask the reader to do (optional)"
        name="callToAction"
        hint="For example: Book a 15-minute call. Up to 200 characters."
        value={values.callToAction}
        error={errors['callToAction']}
        onChange={(event) => {
          set('callToAction', event.target.value);
        }}
      />
      <TextareaField
        label="Proof points (optional)"
        name="proofPoints"
        rows={4}
        hint="One per line, up to 10. For example: Used by 40 sales teams."
        value={values.proofPoints}
        error={errors['proofPoints']}
        onChange={(event) => {
          set('proofPoints', event.target.value);
        }}
      />
      <NeededToStart>
        The offer and what it includes are needed before the campaign can start.
      </NeededToStart>
    </StageFrame>
  );
}

const groupClass = 'grid min-w-0 gap-4 rounded-xl border p-4';
const legendClass = 'px-1 text-base font-semibold';

export function FiltersStage({ context }: StageProps) {
  const form = useStageForm(filtersForm, context);
  const { values, set, errors } = form;
  const lists = context.options.data?.leadLists;
  const excluded = new Set(values.excludedLeadListIds);
  return (
    <StageFrame context={context} form={form}>
      <ChoicesProblem context={context} />
      <fieldset className={groupClass}>
        <legend className={legendClass}>Narrow the audience (optional)</legend>
        <FormField
          label="Countries"
          name="countries"
          hint="Two-letter codes separated by commas, such as US, DE. Up to 50."
          value={values.countries}
          error={errors['countries']}
          onChange={(event) => {
            set('countries', event.target.value);
          }}
        />
        <TextareaField
          label="Industries"
          name="industries"
          rows={3}
          hint="One per line, up to 50."
          value={values.industries}
          error={errors['industries']}
          onChange={(event) => {
            set('industries', event.target.value);
          }}
        />
        <TextareaField
          label="Job titles"
          name="titles"
          rows={3}
          hint="One per line, up to 50."
          value={values.titles}
          error={errors['titles']}
          onChange={(event) => {
            set('titles', event.target.value);
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Smallest company (employees)"
            name="employeeCountMin"
            type="number"
            inputMode="numeric"
            min={1}
            value={values.employeeCountMin}
            error={errors['employeeCountMin']}
            onChange={(event) => {
              set('employeeCountMin', event.target.value);
            }}
          />
          <FormField
            label="Largest company (employees)"
            name="employeeCountMax"
            type="number"
            inputMode="numeric"
            min={1}
            value={values.employeeCountMax}
            error={errors['employeeCountMax']}
            onChange={(event) => {
              set('employeeCountMax', event.target.value);
            }}
          />
        </div>
      </fieldset>
      <fieldset className={groupClass}>
        <legend className={legendClass}>Leave out (optional)</legend>
        <p className="text-sm text-muted-foreground">
          Your workspace&apos;s do-not-contact list always applies as well.
        </p>
        <TextareaField
          label="Domains"
          name="excludedDomains"
          rows={3}
          hint="One per line, up to 100, such as example.com."
          value={values.excludedDomains}
          error={errors['excludedDomains']}
          onChange={(event) => {
            set('excludedDomains', event.target.value);
          }}
        />
        <TextareaField
          label="Email addresses"
          name="excludedEmails"
          rows={3}
          hint="One per line, up to 100."
          value={values.excludedEmails}
          error={errors['excludedEmails']}
          onChange={(event) => {
            set('excludedEmails', event.target.value);
          }}
        />
        <ChoiceGroup
          legend="People on these lead lists"
          error={errors['excludedLeadListIds']}
          {...(lists === undefined
            ? { hint: 'Loading your lead lists…' }
            : lists.length === 0
              ? { hint: 'There are no lead lists in this workspace yet.' }
              : {})}
        >
          {(lists ?? []).map((list) => (
            <CheckboxField
              key={list.id}
              label={list.name}
              checked={excluded.has(list.id)}
              onChange={(event) => {
                const next = new Set(excluded);
                if (event.target.checked) {
                  next.add(list.id);
                } else {
                  next.delete(list.id);
                }
                set('excludedLeadListIds', [...next]);
              }}
            />
          ))}
        </ChoiceGroup>
        <CheckboxField
          label="Skip people who are already in another campaign"
          checked={values.skipContactsInOtherCampaigns}
          onChange={(event) => {
            set('skipContactsInOtherCampaigns', event.target.checked);
          }}
        />
      </fieldset>
      <fieldset className={groupClass}>
        <legend className={legendClass}>How many leads</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="New leads per day"
            name="dailyNewLeads"
            type="number"
            inputMode="numeric"
            min={1}
            hint="From 1 to 500."
            value={values.dailyNewLeads}
            error={errors['dailyNewLeads']}
            onChange={(event) => {
              set('dailyNewLeads', event.target.value);
            }}
          />
          <FormField
            label="Leads in total"
            name="maxLeads"
            type="number"
            inputMode="numeric"
            min={1}
            hint="From 1 to 50,000."
            value={values.maxLeads}
            error={errors['maxLeads']}
            onChange={(event) => {
              set('maxLeads', event.target.value);
            }}
          />
        </div>
        <NeededToStart>
          Both numbers are needed before the campaign can start.
        </NeededToStart>
      </fieldset>
    </StageFrame>
  );
}
