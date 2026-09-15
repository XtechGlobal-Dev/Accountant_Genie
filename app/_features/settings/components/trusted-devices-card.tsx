"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeDevice } from "@/server/modules/auth/actions";
import type { TrustedDeviceRow } from "@/shared/contracts/settings";
import { shortDate } from "@/shared/format";
import { Icon } from "@/ui/icons";
import { Alert, Badge, Button, Card, CardHeader } from "@/ui/primitives";

/**
 * The browsers that may skip this person's six-digit code.
 *
 * Forgetting one is the whole point of showing the list: a laptop left at a
 * client's office is remembered until someone here says otherwise. The
 * browser you are reading this on is marked, so it is not the one you forget
 * by accident.
 */
export function TrustedDevicesCard({ devices }: { devices: TrustedDeviceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function forget(id: string) {
    setError(null);
    setBusy(id);
    startTransition(async () => {
      const result = await revokeDevice(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
      setBusy(null);
    });
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        icon="monitor"
        title="Trusted devices"
        description="Browsers that skip the six-digit code for 30 days. Your password is still asked for on every one."
      />
      <div className="flex flex-1 flex-col px-6 py-1">
        {error ? (
          <div className="py-3">
            <Alert tone="negative">{error}</Alert>
          </div>
        ) : null}

        {devices.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-2">
            No device is remembered. Tick <span className="font-semibold text-ink">Remember this device</span> the next
            time you enter a code.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule-soft">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft/70 text-accent">
                  <Icon name="monitor" className="size-[18px]" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="truncate">{device.label}</span>
                    {device.isCurrent ? <Badge tone="accent">This device</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-ink-3">
                    Trusted {shortDate(device.createdAt)} · last used {shortDate(device.lastUsedAt)} · asks again{" "}
                    {shortDate(device.expiresAt)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  disabled={pending && busy === device.id}
                  onClick={() => forget(device.id)}
                >
                  {pending && busy === device.id ? "Forgetting…" : "Forget"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-rule-soft py-3 text-xs text-ink-3">
          Changing your password forgets every device, here and elsewhere.
        </p>
      </div>
    </Card>
  );
}
