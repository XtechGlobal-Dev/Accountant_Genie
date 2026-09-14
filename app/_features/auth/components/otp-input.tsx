"use client";

/**
 * Six boxes for a six-digit code. Typing advances, backspace retreats, a
 * paste fills all six. The form still submits one `code` field, so the
 * server action is unchanged. A countdown shows how long the code lasts.
 */

import { useEffect, useRef, useState } from "react";
import { cx } from "@/ui/styles";

const LENGTH = 6;

export function OtpInput({ name = "code", expiresInSeconds = 600 }: { name?: string; expiresInSeconds?: number }) {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: LENGTH }, () => ""));
  const [left, setLeft] = useState(expiresInSeconds);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      setLeft(Math.max(0, expiresInSeconds - Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresInSeconds]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function setAt(index: number, value: string) {
    setDigits((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function onChange(index: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (clean.length > 1) {
      // A paste, or autofill: spread it across the boxes.
      const spread = clean.slice(0, LENGTH).split("");
      setDigits((current) => current.map((d, i) => spread[i] ?? d));
      refs.current[Math.min(spread.length, LENGTH) - 1]?.focus();
      return;
    }
    setAt(index, clean);
    if (clean && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      setAt(index - 1, "");
      refs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");

  return (
    <div className="flex flex-col items-center gap-3">
      <input type="hidden" name={name} value={digits.join("")} />
      <div className="flex items-center gap-2" role="group" aria-label="Verification code">
        {digits.map((digit, index) => (
          <span key={index} className="flex items-center gap-2">
            {index === 3 ? <span aria-hidden="true" className="h-px w-3 bg-rule-strong" /> : null}
            <input
              ref={(el) => {
                refs.current[index] = el;
              }}
              inputMode="numeric"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={LENGTH}
              value={digit}
              onChange={(event) => onChange(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              onFocus={(event) => event.target.select()}
              aria-label={`Digit ${index + 1}`}
              className={cx(
                "figure size-12 rounded-xl border border-rule bg-surface text-center text-xl font-bold text-ink shadow-xs outline-none transition-[border-color,box-shadow]",
                "focus:border-accent focus:ring-4 focus:ring-accent/15",
                digit && "border-accent/60",
              )}
            />
          </span>
        ))}
      </div>
      <p className={cx("figure text-[13px] font-semibold", left === 0 ? "text-negative-ink" : "text-ink-3")}>
        {left === 0 ? "The code has expired — send a new one" : `Code expires in ${minutes}:${seconds}`}
      </p>
    </div>
  );
}
