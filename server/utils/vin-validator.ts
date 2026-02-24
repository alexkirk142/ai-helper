const VIN_TRANSLITERATION: Record<string, number> = {
  A:1, B:2, C:3, D:4, E:5, F:6, G:7, H:8,
  J:1, K:2, L:3, M:4, N:5, P:7, R:9,
  S:2, T:3, U:4, V:5, W:6, X:7, Y:8, Z:9,
  '0':0, '1':1, '2':2, '3':3, '4':4,
  '5':5, '6':6, '7':7, '8':8, '9':9,
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function calculateVinChecksum(vin: string): string {
  const sum = vin.toUpperCase().split('').reduce((acc, char, i) => {
    return acc + (VIN_TRANSLITERATION[char] ?? 0) * VIN_WEIGHTS[i];
  }, 0);
  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

export function isValidVinChecksum(vin: string): boolean {
  if (vin.length !== 17) return false;
  return calculateVinChecksum(vin) === vin[8].toUpperCase();
}

// Visually similar character substitution pairs (OCR confusion set)
const SIMILAR_CHARS: Record<string, string[]> = {
  'S': ['5'], '5': ['S'],
  'B': ['8'], '8': ['B'],
  'Z': ['2'], '2': ['Z'],
  'G': ['6'], '6': ['G'],
  'D': ['0'],
  'I': ['1'], '1': ['I'],
};

/**
 * Attempts to auto-correct a VIN with OCR errors by substituting visually
 * similar characters one position at a time until the checksum passes.
 * Returns the corrected VIN, or null if no single-character fix works.
 */
export function tryAutoCorrectVin(vin: string): string | null {
  if (isValidVinChecksum(vin)) return vin;

  const chars = vin.toUpperCase().split('');

  for (let i = 0; i < 17; i++) {
    const alternatives = SIMILAR_CHARS[chars[i]];
    if (!alternatives) continue;

    for (const alt of alternatives) {
      const candidate = [...chars];
      candidate[i] = alt;
      const candidateVin = candidate.join('');
      if (isValidVinChecksum(candidateVin)) {
        return candidateVin;
      }
    }
  }

  return null;
}
