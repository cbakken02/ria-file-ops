import type { ClientMemoryRule } from "@/lib/db";

const NICKNAME_EQUIVALENTS: Record<string, Set<string>> = {
  christopher: new Set(["christopher", "chris", "topher"]),
  chris: new Set(["christopher", "chris", "topher"]),
  topher: new Set(["christopher", "chris", "topher"]),
  michael: new Set(["michael", "mike", "mikey"]),
  mike: new Set(["michael", "mike", "mikey"]),
  matthew: new Set(["matthew", "matt"]),
  matt: new Set(["matthew", "matt"]),
  william: new Set(["william", "will", "bill", "billy", "liam"]),
  will: new Set(["william", "will", "bill", "billy"]),
  bill: new Set(["william", "will", "bill", "billy"]),
  joseph: new Set(["joseph", "joe", "joey"]),
  joe: new Set(["joseph", "joe", "joey"]),
  robert: new Set(["robert", "rob", "bob", "bobby"]),
  rob: new Set(["robert", "rob", "bob", "bobby"]),
  bob: new Set(["robert", "rob", "bob", "bobby"]),
  daniel: new Set(["daniel", "dan", "danny"]),
  dan: new Set(["daniel", "dan", "danny"]),
  anthony: new Set(["anthony", "tony"]),
  tony: new Set(["anthony", "tony"]),
  nicholas: new Set(["nicholas", "nick", "nicky"]),
  nick: new Set(["nicholas", "nick", "nicky"]),
  james: new Set(["james", "jim", "jimmy"]),
  jim: new Set(["james", "jim", "jimmy"]),
  john: new Set(["john", "jon", "johnny", "jack"]),
  jon: new Set(["john", "jon"]),
  andrew: new Set(["andrew", "andy", "drew"]),
  andy: new Set(["andrew", "andy", "drew"]),
  david: new Set(["david", "dave"]),
  dave: new Set(["david", "dave"]),
  thomas: new Set(["thomas", "tom", "tommy"]),
  tom: new Set(["thomas", "tom", "tommy"]),
  richard: new Set(["richard", "rick", "ricky", "dick"]),
  rick: new Set(["richard", "rick", "ricky"]),
  charles: new Set(["charles", "charlie", "chuck"]),
  charlie: new Set(["charles", "charlie", "chuck"]),
  steven: new Set(["steven", "steve"]),
  stephen: new Set(["stephen", "steve"]),
  steve: new Set(["steven", "stephen", "steve"]),
  jennifer: new Set(["jennifer", "jen", "jenny"]),
  jen: new Set(["jennifer", "jen", "jenny"]),
  elizabeth: new Set(["elizabeth", "liz", "beth", "lizzy"]),
  liz: new Set(["elizabeth", "liz"]),
  beth: new Set(["elizabeth", "beth"]),
  katherine: new Set(["katherine", "katie", "kate", "kat"]),
  katie: new Set(["katherine", "katie", "kate"]),
  kate: new Set(["katherine", "katie", "kate"]),
  alexandra: new Set(["alexandra", "alex", "lexi"]),
  alex: new Set(["alexandra", "alex", "lexi"]),
  samantha: new Set(["samantha", "sam", "sammy"]),
  sam: new Set(["samantha", "sam", "sammy"]),
};

type ParsedPersonName = {
  first: string;
  middleTokens: string[];
  last: string;
};

type ParsedHouseholdFolder = {
  last: string;
  memberFirsts: string[];
};

export type ClientMatchResult = {
  candidateScores: Array<{
    folderName: string;
    reason: string;
    score: number;
  }>;
  folderName: string | null;
  matchReason: string;
  status: "matched_existing" | "created_new" | "needs_review";
};

export function resolveClientFolderName(
  rawClientName: string | null,
  existingFolders: string[],
  clientMemoryRules: ClientMemoryRule[] = [],
) {
  const aliasIndex = buildClientAliasIndex(existingFolders);
  const memoryIndex = buildClientMemoryIndex(clientMemoryRules);
  const parsedInput = parsePersonName(rawClientName);
  const candidateMap = new Map<
    string,
    { folderName: string; reason: string; score: number }
  >();
  const sameLastNameFolders = new Set<string>();

  const addCandidate = (folderName: string, reason: string, score: number) => {
    const current = candidateMap.get(folderName);
    if (!current || score > current.score) {
      candidateMap.set(folderName, { folderName, reason, score });
    }
  };

  if (rawClientName) {
    const exactMemoryMatch = memoryIndex.exact.get(cleanNameText(rawClientName).toLowerCase());
    if (exactMemoryMatch) {
      addCandidate(
        exactMemoryMatch,
        "Matched learned client memory from prior human review",
        120,
      );
    }

    for (const key of nameKeysForMatching(rawClientName)) {
      const memoryFolder = memoryIndex.alias.get(key);
      if (memoryFolder) {
        addCandidate(
          memoryFolder,
          `Matched learned client memory alias: ${key}`,
          115,
        );
      }
    }

    for (const key of nameKeysForMatching(rawClientName)) {
      const folderName = aliasIndex.get(key);
      if (folderName) {
        addCandidate(folderName, `Matched alias key: ${key}`, 100);
      }
    }
  }

  if (parsedInput) {
    for (const folderName of existingFolders) {
      const parsedFolder = parseHouseholdFolderName(folderName);
      if (!parsedFolder) {
        continue;
      }

      let score = 0;
      const reasons: string[] = [];

      if (parsedInput.last === parsedFolder.last) {
        score += 50;
        reasons.push("last name exact");
        sameLastNameFolders.add(folderName);

        const exactMember = parsedFolder.memberFirsts.find(
          (memberFirst) => parsedInput.first === memberFirst,
        );
        const closeMember = parsedFolder.memberFirsts.find((memberFirst) =>
          firstNamesAreClose(parsedInput.first, memberFirst),
        );

        if (exactMember) {
          score += 35;
          reasons.push("first name exact");
        } else if (closeMember) {
          score += 25;
          reasons.push("first name close");
        }
      }

      if (score > 0) {
        addCandidate(folderName, reasons.join(", "), score);
      }
    }
  }

  const candidateScores = [...candidateMap.values()].sort(
    (left, right) => right.score - left.score,
  );
  const best = candidateScores[0];

  if (best && best.score >= 75) {
    return {
      folderName: best.folderName,
      matchReason: `Matched existing client: ${best.reason} (score ${best.score})`,
      status: "matched_existing" as const,
      candidateScores,
    };
  }

  if (parsedInput && sameLastNameFolders.size > 0) {
    return {
      folderName: null,
      matchReason: `Needs review: same last name already exists (${[
        ...sameLastNameFolders,
      ].sort().join(", ")})`,
      status: "needs_review" as const,
      candidateScores,
    };
  }

  const canonicalFolder = canonicalFolderNameFromPerson(rawClientName);
  if (canonicalFolder) {
    return {
      folderName: canonicalFolder,
      matchReason: "Created canonical client folder name from extracted client match",
      status: "created_new" as const,
      candidateScores,
    };
  }

  return {
    folderName: null,
    matchReason: "Needs review: could not confidently resolve the client name.",
    status: "needs_review" as const,
    candidateScores,
  };
}

export function suggestCanonicalClientFolderName(rawName: string | null) {
  return canonicalFolderNameFromPerson(rawName);
}

export function resolveHouseholdFolderName(
  rawClientName: string | null,
  rawClientName2: string | null,
  existingFolders: string[],
  clientMemoryRules: ClientMemoryRule[] = [],
) {
  const primaryMatch = resolveClientFolderName(
    rawClientName,
    existingFolders,
    clientMemoryRules,
  );
  const primaryParsed = parsePersonName(rawClientName);
  const secondaryParsed = parsePersonName(rawClientName2);

  if (!primaryParsed || !secondaryParsed) {
    return primaryMatch;
  }

  const candidateScores = [...primaryMatch.candidateScores];

  for (const folderName of existingFolders) {
    const parsedFolder = parseHouseholdFolderName(folderName);
    if (!parsedFolder || parsedFolder.memberFirsts.length < 2) {
      continue;
    }

    const primaryMatches = parsedFolder.memberFirsts.some((memberFirst) =>
      firstNamesAreClose(primaryParsed.first, memberFirst),
    );
    const secondaryMatches = parsedFolder.memberFirsts.some((memberFirst) =>
      firstNamesAreClose(secondaryParsed.first, memberFirst),
    );

    if (
      parsedFolder.last === primaryParsed.last &&
      parsedFolder.last === secondaryParsed.last &&
      primaryMatches &&
      secondaryMatches
    ) {
      const match = {
        folderName,
        reason: "matched household folder members",
        score: 135,
      };

      candidateScores.push(match);

      return {
        candidateScores: candidateScores.sort((left, right) => right.score - left.score),
        folderName: match.folderName,
        matchReason: "Matched existing household folder using both named clients",
        status: "matched_existing" as const,
      };
    }
  }

  if (primaryMatch.status === "matched_existing") {
    return primaryMatch;
  }

  const suggestedHousehold = suggestCanonicalHouseholdFolderName(
    rawClientName,
    rawClientName2,
  );
  if (suggestedHousehold) {
    return {
      candidateScores: candidateScores.sort((left, right) => right.score - left.score),
      folderName: suggestedHousehold,
      matchReason: "Created canonical household folder name from extracted household members",
      status: "created_new" as const,
    };
  }

  return primaryMatch;
}

export function suggestCanonicalHouseholdFolderName(
  rawClientName: string | null,
  rawClientName2: string | null,
) {
  const primary = parsePersonName(rawClientName);
  if (!primary) {
    return null;
  }

  const secondary = parsePersonName(rawClientName2);
  if (!secondary) {
    return canonicalFolderNameFromPerson(rawClientName);
  }

  if (primary.last === secondary.last) {
    const orderedFirsts = [primary.first, secondary.first].sort((left, right) =>
      left.localeCompare(right),
    );

    return `${smartCap(primary.last)}_${orderedFirsts.map(smartCap).join("_")}`;
  }

  return `${smartCap(primary.last)}_${smartCap(primary.first)}_${smartCap(
    secondary.last,
  )}_${smartCap(secondary.first)}`;
}

function buildClientAliasIndex(folderNames: string[]) {
  const aliasIndex = new Map<string, string>();

  for (const folderName of folderNames) {
    const parsedFolder = parseHouseholdFolderName(folderName);
    if (!parsedFolder) {
      continue;
    }

    for (const memberFirst of parsedFolder.memberFirsts) {
      const canonicalName = `${memberFirst} ${parsedFolder.last}`.trim();
      for (const key of nameKeysForMatching(canonicalName)) {
        aliasIndex.set(key, folderName);
      }
    }
  }

  return aliasIndex;
}

function buildClientMemoryIndex(clientMemoryRules: ClientMemoryRule[]) {
  const exact = new Map<string, string>();
  const alias = new Map<string, string>();

  for (const rule of clientMemoryRules) {
    const cleaned = cleanNameText(rule.rawClientName).toLowerCase();
    if (cleaned) {
      exact.set(cleaned, rule.learnedClientFolder);
    }

    for (const key of nameKeysForMatching(rule.rawClientName)) {
      alias.set(key, rule.learnedClientFolder);
    }
  }

  return { exact, alias };
}

function cleanNameText(name: string | null | undefined) {
  if (!name) {
    return "";
  }

  return String(name).trim().replaceAll("_", " ").replace(/\s+/g, " ");
}

function tokenizeName(name: string | null | undefined) {
  const cleaned = cleanNameText(name)
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?,?/gi, " ")
    .replaceAll(",", " ")
    .replace(/[^A-Za-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return cleaned ? cleaned.split(" ") : [];
}

function parsePersonName(name: string | null | undefined): ParsedPersonName | null {
  const rawName = cleanNameText(name);
  if (!rawName) {
    return null;
  }

  if (rawName.includes(",")) {
    const [left, right] = rawName.split(",", 2).map((part) => part.trim());
    const lastTokens = tokenizeName(left);
    const remainingTokens = tokenizeName(right);

    if (!lastTokens.length || !remainingTokens.length) {
      return null;
    }

    return {
      first: remainingTokens[0],
      middleTokens: remainingTokens.slice(1),
      last: lastTokens[lastTokens.length - 1],
    };
  }

  const tokens = tokenizeName(rawName);
  if (tokens.length < 2) {
    return null;
  }

  return {
    first: tokens[0],
    middleTokens: tokens.slice(1, -1),
    last: tokens[tokens.length - 1],
  };
}

function parseHouseholdFolderName(
  folderName: string | null | undefined,
): ParsedHouseholdFolder | null {
  if (!folderName) {
    return null;
  }

  const parts = String(folderName)
    .split("_")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return {
    last: parts[0].toLowerCase(),
    memberFirsts: parts.slice(1).map((part) => part.toLowerCase()),
  };
}

function nicknameVariants(firstName: string) {
  const normalized = firstName.toLowerCase();
  const direct = NICKNAME_EQUIVALENTS[normalized] ?? new Set([normalized]);
  const reverseMatches = Object.entries(NICKNAME_EQUIVALENTS)
    .filter(([, variants]) => variants.has(normalized))
    .map(([name]) => name);

  return new Set([...direct, ...reverseMatches, normalized]);
}

function nameKeysForMatching(rawName: string) {
  const parsed = parsePersonName(rawName);
  if (!parsed) {
    return new Set<string>();
  }

  const keys = new Set<string>();

  for (const firstVariant of nicknameVariants(parsed.first)) {
    keys.add(`${parsed.last}|${firstVariant}`);

    for (const middle of parsed.middleTokens) {
      if (!middle) {
        continue;
      }

      keys.add(`${parsed.last}|${firstVariant}|${middle[0]}`);
      keys.add(`${parsed.last}|${firstVariant}|${middle}`);
    }
  }

  return keys;
}

function canonicalFolderNameFromPerson(rawName: string | null) {
  const parsed = parsePersonName(rawName);
  if (!parsed) {
    return null;
  }

  return `${smartCap(parsed.last)}_${smartCap(parsed.first)}`;
}

function firstNamesAreClose(nameOne: string, nameTwo: string) {
  const left = nameOne.toLowerCase();
  const right = nameTwo.toLowerCase();

  if (left === right) {
    return true;
  }

  if (nicknameVariants(left).has(right) || nicknameVariants(right).has(left)) {
    return true;
  }

  return simpleEditDistance(left, right) <= 1;
}

function simpleEditDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    dp[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    dp[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + cost,
      );
    }
  }

  return dp[rows - 1][cols - 1];
}

function smartCap(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}
