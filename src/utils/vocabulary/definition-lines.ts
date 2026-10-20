/**
 * Parsers for the dictionary text stored on a vocabulary word.
 *
 * The backend normally stores one line per sense, but older entries can carry
 * the same content on a single line. Splitting those markers here keeps every
 * card readable without changing what is stored in the vocabulary book.
 */

export interface PhoneticPart {
  label: string
  value: string
}

/**
 * Split the stored dictionary text into displayable lines.
 *
 * `word` is stripped from the head because callers render it as their own
 * heading, which would otherwise produce "rather rather".
 */
export function parseCardDefinitionLines(translation: string, word: string): string[] {
  const lines = translation
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap(line => line
      .replace(/\s+(?=(?:英|美)\s+\/)/g, "\n")
      .replace(/\s+(?=(?:\d+|❑)\.\s+[a-z]+\.)/gi, "\n")
      .split("\n"),
    )
    .map(line => line.trim())
    .filter(Boolean)

  const cleanWord = word.trim()
  const firstLine = lines[0]?.toLowerCase()
  const normalizedWord = cleanWord.toLowerCase()

  if (firstLine === normalizedWord) {
    return lines.slice(1)
  }
  if (firstLine?.startsWith(`${normalizedWord} `)) {
    return [lines[0].slice(cleanWord.length).trim(), ...lines.slice(1)].filter(Boolean)
  }

  return lines
}

/**
 * Recognise a stored "英 /x/ 美 /y/" line, or `null` for an ordinary sense line.
 *
 * The card renders phonetics as its own labelled row, so they must be pulled
 * out of the text flow.
 */
export function parsePhoneticLine(line: string): PhoneticPart[] | null {
  const rawParts = line.trim().split(/\s+(?=(?:英|美)\s+\/)/)
  const parts: PhoneticPart[] = []

  for (const rawPart of rawParts) {
    const match = rawPart.match(/^(英|美)\s+(\/[^/]+\/)$/)
    if (!match) {
      return null
    }
    parts.push({ label: match[1], value: match[2] })
  }

  return parts.length > 0 ? parts : null
}

/**
 * Attach a stable React key to each parsed line.
 *
 * Dictionary definitions repeat lines ("adj. 短暂地" can appear under several
 * senses), so the key needs an occurrence counter rather than the raw text —
 * and the index, which would remount every sibling whenever a line shifts.
 */
export function withDefinitionLineKeys(lines: string[]): { line: string, key: string }[] {
  const occurrences = new Map<string, number>()

  return lines.map((line) => {
    const occurrence = occurrences.get(line) ?? 0
    occurrences.set(line, occurrence + 1)
    return { line, key: `${line}-${occurrence}` }
  })
}
