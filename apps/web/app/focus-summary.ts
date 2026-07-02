export function splitTopLevelList(value: string) {
  const items: string[] = [];
  let current = "";
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    }
    if (character === ")" && depth > 0) {
      depth -= 1;
    }

    const nextCharacter = value[index + 1];
    if (character === "," && depth === 0 && !/\d/.test(nextCharacter ?? "")) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items.map((item) => item.replace(/^and\s+/i, "").trim()).filter(Boolean);
}

/**
 * Strip a redundant leading "Now:" / "Now -" label from a bullet. The app already renders
 * bullets under a "Now" heading, so older stored summaries that labeled each bullet should
 * render clean. Only strips when "now" is followed by a ':' or '-' separator, so sentences
 * that merely start with the word "Now" (e.g. "Now that the PR merged...") are untouched.
 */
function stripNowLabel(bullet: string) {
  return bullet.replace(/^now\s*:\s*|^now\s+[-–—]\s+/i, "").trim();
}

export function focusSummaryBullets(summaryText: string | undefined) {
  if (!summaryText?.trim()) {
    return ["No stored focus summary yet. A harness can generate one through the MCP."];
  }

  const trimmed = summaryText.trim();
  const markdownBullets = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+|^\d+\.\s+/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^summary:/i.test(line))
    .map(stripNowLabel)
    .filter(Boolean);
  if (markdownBullets.length > 1) {
    return markdownBullets;
  }

  const [primaryText = "", supportingText] = trimmed.split(/\s+Supporting items:\s+/i);
  const bullets: string[] = [];
  const primaryParts = primaryText.split(/:\s+/);
  if (primaryParts.length > 1) {
    bullets.push((primaryParts[0] ?? "").replace(/\.$/, "."));
    bullets.push(...primaryParts.slice(1).join(": ").split(/\s+and\s+/i).map((item) => item.trim()));
  } else {
    bullets.push(primaryText);
  }

  if (supportingText) {
    bullets.push(...splitTopLevelList(supportingText.replace(/\.$/, "")));
  }

  return bullets
    .map(stripNowLabel)
    .map((bullet) => bullet.replace(/\.$/, "").trim())
    .filter(Boolean)
    .map((bullet) => `${bullet[0]?.toUpperCase() ?? ""}${bullet.slice(1)}.`);
}

function plainFocusText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/\.$/, "")
    .trim();
}

function isGenericFocusLead(value: string) {
  return /^(today:|today's\s+(focus|priorities)\b|current focus\b|focus summary\b)/i.test(plainFocusText(value));
}

function isStandingContextFocusItem(value: string) {
  const text = plainFocusText(value).toLowerCase();

  return (
    /^use\b.*\b(as|owner context|primary user|standing context|ongoing context)\b/.test(text) ||
    /^consider\b.*\b(as|context|standing|owner|primary)\b/.test(text) ||
    /^(treat|remember|assume|interpret|recognize|regard)\b/.test(text) ||
    /^keep in mind\b/.test(text) ||
    /\bas\s+(the\s+)?(ongoing|primary|default|standing|owner|high-signal)\b/.test(text) ||
    /\b(owner context|primary user|primary contact|standing context|ongoing context)\b/.test(text)
  );
}

export function isActionableFocusItem(value: string) {
  const text = plainFocusText(value);
  const lower = text.toLowerCase();
  if (!lower || isGenericFocusLead(text) || isStandingContextFocusItem(text)) {
    return false;
  }

  if (/^continue\s+(building|drafting|reviewing|testing|implementing|fixing|monitoring|working)\b/.test(lower)) {
    return true;
  }

  return /\b(monitor|review|reply|respond|follow up|follow-up|schedule|prepare|complete|finish|check|verify|confirm|call|email|send|pay|renew|cancel|update|fix|build|deploy|ship|create|draft|decide|resolve|investigate|triage|watch|track)\b/.test(
    lower,
  );
}

function joinHeadingParts(parts: string[]) {
  if (parts.length <= 1) {
    return parts[0] ?? "Current focus";
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function focusCategoryForBullet(value: string) {
  const text = value.toLowerCase();
  if (/(amazon|usps|deliver|shipment|package)/.test(text)) {
    return "deliveries";
  }
  if (/(subscription|prime video|mgm\+|trial|renewal)/.test(text)) {
    return "subscriptions";
  }
  if (/(chase|card statement|credit card|refund|bill|payment|balance|auto-pay|spend)/.test(text)) {
    return "finance";
  }
  if (/(skippy|mcp|convex|pwa|web app|roadmap|build|vercel|github|deployment)/.test(text)) {
    return "Skippy build";
  }
  if (/(calendar|meeting|appointment|call)/.test(text)) {
    return "calendar";
  }
  if (/(email|reply|follow up|follow-up)/.test(text)) {
    return "follow-ups";
  }
  return undefined;
}

type FocusCategory = NonNullable<ReturnType<typeof focusCategoryForBullet>>;

export function focusSummaryPresentation(bullets: string[]) {
  const [firstBullet = "Current focus"] = bullets;
  const firstIsGeneric = isGenericFocusLead(firstBullet);
  const actionableDetails = bullets.filter(isActionableFocusItem);
  const categoryOrder: FocusCategory[] = ["deliveries", "subscriptions", "finance", "Skippy build", "calendar", "follow-ups"];
  const categoryLabels = Array.from(
    new Set(actionableDetails.map(focusCategoryForBullet).filter((label): label is FocusCategory => Boolean(label))),
  )
    .sort((left, right) => categoryOrder.indexOf(left) - categoryOrder.indexOf(right))
    .slice(0, 4);

  if (!actionableDetails.length) {
    return {
      heading: "Nothing new needs focus right now.",
      details: [],
    };
  }

  if (categoryLabels.length >= 2) {
    return {
      heading: `Today: ${joinHeadingParts(categoryLabels)}.`,
      details: actionableDetails,
    };
  }

  if (categoryLabels.length === 1) {
    return {
      heading:
        actionableDetails.length > 1
          ? `Today: ${categoryLabels[0]} priorities.`
          : `Today: ${categoryLabels[0]}.`,
      details: actionableDetails,
    };
  }

  if (actionableDetails.length > 1) {
    return {
      heading: `Today: ${actionableDetails.length} priorities need attention.`,
      details: actionableDetails,
    };
  }

  const heading = !firstIsGeneric && !isActionableFocusItem(firstBullet) && !isStandingContextFocusItem(firstBullet)
    ? firstBullet
    : "Current focus.";

  return {
    heading,
    details: actionableDetails,
  };
}

/**
 * Pull the explicit "Summary:" headline the focus model now emits. Falls back to the
 * heuristic heading when the model didn't include one (older summaries).
 */
export function parseFocusSummary(summaryText: string | undefined): {
  headline: string;
  bullets: string[];
} {
  const bullets = focusSummaryBullets(summaryText);
  const explicit = (summaryText ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /^summary:/i.test(line));
  if (explicit) {
    const headline = explicit.replace(/^summary:\s*/i, "").trim();
    if (headline) {
      return { headline, bullets };
    }
  }
  return { headline: focusSummaryPresentation(bullets).heading, bullets };
}

export function focusItemKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
