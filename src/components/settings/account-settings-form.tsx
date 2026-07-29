"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AccountProfileInput,
  type AccountProfileResponse,
  accountProfileSchema,
} from "@/domain/account/onboarding";
import type { ProblemDetails } from "@/domain/http/problem";
import { apiRequest } from "@/lib/api-client";

import { SETTINGS_SECTION_CLASS_NAME } from "./settings-section";

interface AccountSettingsFormProps {
  initialTimezone: string;
  initialLocale: string;
}

export function AccountSettingsForm({
  initialTimezone,
  initialLocale,
}: AccountSettingsFormProps) {
  const [status, setStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AccountProfileInput>({
    defaultValues: {
      timezone: initialTimezone,
      locale: initialLocale,
    },
    resolver: zodResolver(accountProfileSchema),
  });
  const previewInput = accountProfileSchema.safeParse(useWatch({ control }));
  const formattingPreview = previewInput.success
    ? new Intl.DateTimeFormat(previewInput.data.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: previewInput.data.timezone,
      }).format(new Date("2026-07-20T13:00:00.000Z"))
    : null;

  const save = handleSubmit(
    async (values) => {
      setStatus(null);
      let response;
      try {
        response = await apiRequest<AccountProfileResponse | ProblemDetails>(
          "/api/v1/account",
          {
            method: "PATCH",
            body: JSON.stringify(values),
          },
        );
      } catch {
        setStatus({
          kind: "error",
          message: "We couldn't save while offline. Your edit is still here.",
        });
        return;
      }

      if (response.ok) {
        setStatus({
          kind: "success",
          message: "Timezone and formatting saved.",
        });
        return;
      }

      const problem = response.body as ProblemDetails | null;
      if (problem?.fieldErrors) {
        for (const field of ["timezone", "locale"] as const) {
          const message = problem.fieldErrors[field]?.[0];
          if (message) setError(field, { message });
        }
      }
      setStatus({
        kind: "error",
        message:
          problem?.detail ?? "We couldn't save your changes. Please try again.",
      });
    },
    () => setStatus(null),
  );

  return (
    <section
      aria-labelledby="timezone-title"
      className={SETTINGS_SECTION_CLASS_NAME}
      id="timezone"
    >
      <h2 id="timezone-title" className="text-lg font-medium">
        Timezone
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Change your planning context without changing the instant or original
        timezone meaning of imported events.
      </p>

      <form className="mt-5 flex flex-col gap-4" onSubmit={save} noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Time zone</span>
          <Input
            aria-label="Time zone"
            aria-describedby={
              errors.timezone ? "timezone-error" : "timezone-hint"
            }
            aria-invalid={Boolean(errors.timezone)}
            autoComplete="off"
            {...register("timezone")}
          />
          {errors.timezone ? (
            <span className="text-xs text-destructive" id="timezone-error">
              {errors.timezone.message}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground" id="timezone-hint">
              IANA identifier, e.g. America/New_York.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Date and time format</span>
          <Input
            aria-label="Date and time format"
            aria-describedby={errors.locale ? "locale-error" : "locale-hint"}
            aria-invalid={Boolean(errors.locale)}
            autoComplete="off"
            {...register("locale")}
          />
          {errors.locale ? (
            <span className="text-xs text-destructive" id="locale-error">
              {errors.locale.message}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground" id="locale-hint">
              BCP 47 locale, e.g. en-US. Interface copy remains in English.
            </span>
          )}
        </label>

        {formattingPreview ? (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Formatting preview: </span>
            <span data-testid="formatting-preview">{formattingPreview}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
          {status ? (
            <p
              className={
                status.kind === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
              role={status.kind === "error" ? "alert" : "status"}
            >
              {status.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
