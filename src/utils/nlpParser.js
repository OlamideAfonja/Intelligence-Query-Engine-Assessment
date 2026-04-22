'use strict';

const { findCountryCode } = require('./countries');

/**
 * Parses a plain-English query string into structured filter parameters.
 *
 * Supported mappings
 * ──────────────────
 * Gender  : male/males/man/men/boy/boys         → gender=male
 *           female/females/woman/women/girl/girls → gender=female
 *           both present                         → no gender filter
 *
 * Age group: child/children/kids                → age_group=child
 *            teenager/teen/teenagers/teens      → age_group=teenager
 *            adult/adults                       → age_group=adult
 *            senior/seniors/elderly             → age_group=senior
 *
 * "young"  : maps to min_age=16, max_age=24     (NOT an age_group)
 *
 * Age mods : above/over N  / "older than N"     → min_age=N
 *            below/under N / "younger than N"   → max_age=N
 *            "between N and M"                  → min_age=N, max_age=M
 *            (modifiers override "young" range)
 *
 * Country  : "from [name]" / "in [name]"        → country_id=XX
 *
 * @param {string} queryString
 * @returns {{ [key: string]: string|number }|null}
 *   Parsed filters, or null when the query cannot be interpreted.
 */
function parseQuery(queryString) {
  if (!queryString || !queryString.trim()) return null;

  const q = queryString.toLowerCase().trim();
  const filters = {};

  // ── 1. Gender ────────────────────────────────────────────────────────────────
  const hasMale = /\b(males?|men|man|boys?)\b/.test(q);
  const hasFemale = /\b(females?|women|woman|girls?)\b/.test(q);

  if (hasMale && !hasFemale) filters.gender = 'male';
  else if (hasFemale && !hasMale) filters.gender = 'female';
  // both → no gender filter (e.g. "male and female teenagers")

  // ── 2. Age group ─────────────────────────────────────────────────────────────
  if (/\b(children|child|kids?)\b/.test(q)) {
    filters.age_group = 'child';
  } else if (/\b(teen(ager)?s?|adolescents?)\b/.test(q)) {
    filters.age_group = 'teenager';
  } else if (/\badults?\b/.test(q)) {
    filters.age_group = 'adult';
  } else if (/\b(seniors?|elderly)\b/.test(q)) {
    filters.age_group = 'senior';
  }

  // ── 3. "young" → age range 16–24 ─────────────────────────────────────────────
  if (/\byoung\b/.test(q)) {
    filters.min_age = 16;
    filters.max_age = 24;
  }

  // ── 4. Explicit age modifiers (override "young" range as needed) ──────────────
  const betweenMatch = q.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\b/);
  if (betweenMatch) {
    filters.min_age = parseInt(betweenMatch[1], 10);
    filters.max_age = parseInt(betweenMatch[2], 10);
  } else {
    // "above 30", "over 30", "older than 30", "at least 30"
    const aboveMatch = q.match(/\b(?:above|over|older than|at least)\s+(\d+)\b/);
    if (aboveMatch) filters.min_age = parseInt(aboveMatch[1], 10);

    // "below 30", "under 30", "younger than 30", "at most 30"
    const belowMatch = q.match(/\b(?:below|under|younger than|at most)\s+(\d+)\b/);
    if (belowMatch) filters.max_age = parseInt(belowMatch[1], 10);
  }

  // ── 5. Country ────────────────────────────────────────────────────────────────
  // Match "from X" or "in X" where X runs until a known stop-word or end of string
  const STOP_WORDS =
    'above|below|over|under|between|aged?|who|with|and|that|where|having|with';
  const countryRegex = new RegExp(
    `\\b(?:from|in)\\s+([a-z][a-z '\\-]*)(?:\\s+(?:${STOP_WORDS})\\b|$)`
  );
  const countryMatch = q.match(countryRegex);
  if (countryMatch) {
    const candidate = countryMatch[1].trim();
    const code = findCountryCode(candidate);
    if (code) filters.country_id = code;
  }

  // ── 6. Interpretability check ─────────────────────────────────────────────────
  if (Object.keys(filters).length === 0) return null;

  return filters;
}

module.exports = { parseQuery };
