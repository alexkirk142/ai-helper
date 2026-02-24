/**
 * GPT-based universal extractor for driveType and gearboxType from PartsAPI rawData.
 * Used as a final fallback when regex-based parsing of modifikaciya/opcii/kpp fields
 * fails to produce values — handles any manufacturer, any market, any field structure.
 * Cost: ~50 tokens per call. Only invoked when at least one of the two values is null.
 */

import { openai } from "./decision-engine";

const SYSTEM_PROMPT = `You are a vehicle data parser.
Given raw vehicle catalog data in JSON format, extract exactly two values:
- driveType: "4WD", "2WD", or null (if cannot determine)
- gearboxType: "CVT", "MT", "AT", or null (if cannot determine)

Rules:
- 4WD/AWD/FULL/ПОЛНЫЙ/4x4 → "4WD"
- 2WD/FWD/FRONT/ПЕРЕДНИЙ/RWD/REAR/ЗАДНИЙ → "2WD"
- CVT/VARIABLE/ВАРИАТОР/CONTINUOUSLY VARIABLE → "CVT"
- MT/MANUAL/МЕХАН/МКПП → "MT"
- AT/AUTOMATIC/АВТОМАТ/АКПП → "AT"

Look in ALL fields: modifikaciya, opcii, privod, kpp, tip_kpp, opisanie,
naimenovanie, modely — anywhere in the data.
If a field contains both AT and CVT mentions, prefer CVT.

Return ONLY valid JSON, no markdown:
{"driveType": "4WD"|"2WD"|null, "gearboxType": "CVT"|"MT"|"AT"|null}`;

export interface VehicleContextExtract {
  driveType: string | null;
  gearboxType: string | null;
}

export async function extractVehicleContextFromRawData(
  rawData: Record<string, unknown>
): Promise<VehicleContextExtract> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 50,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(rawData) },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const text = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(text) as Partial<VehicleContextExtract>;

    const validDriveTypes = ["4WD", "2WD"] as const;
    const validGearboxTypes = ["CVT", "MT", "AT"] as const;

    return {
      driveType: validDriveTypes.includes(parsed.driveType as any)
        ? (parsed.driveType as string)
        : null,
      gearboxType: validGearboxTypes.includes(parsed.gearboxType as any)
        ? (parsed.gearboxType as string)
        : null,
    };
  } catch {
    return { driveType: null, gearboxType: null };
  }
}
