"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/ui/primitives";

/** A financial-year picker for reports that only make sense for a whole year. */
export function FyPicker({
  basePath,
  fy,
  financialYears,
}: {
  basePath: string;
  fy: number;
  financialYears: readonly number[];
}) {
  const router = useRouter();
  return (
    <Select
      name="fy"
      aria-label="Financial year"
      value={String(fy)}
      onChange={(event) => router.push(`${basePath}?fy=${event.target.value}`)}
      className="w-36"
    >
      {financialYears.map((year) => (
        <option key={year} value={year}>
          FY{year}
        </option>
      ))}
    </Select>
  );
}
