'use strict';

const db = require('../db');
const { parseQuery } = require('../utils/nlpParser');

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_SORT_BY = new Set(['age', 'created_at', 'gender_probability']);
const VALID_ORDER = new Set(['asc', 'desc']);
const VALID_GENDERS = new Set(['male', 'female']);
const VALID_AGE_GROUPS = new Set(['child', 'teenager', 'adult', 'senior']);
const MAX_LIMIT = 50;

const VALID_GET_PARAMS = new Set([
  'gender', 'age_group', 'country_id',
  'min_age', 'max_age',
  'min_gender_probability', 'min_country_probability',
  'sort_by', 'order', 'page', 'limit',
]);
const VALID_SEARCH_PARAMS = new Set(['q', 'page', 'limit']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a Date as "YYYY-MM-DDTHH:MM:SSZ" (UTC, no milliseconds). */
function formatDate(d) {
  if (!d) return null;
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatRow(row) {
  return { ...row, created_at: formatDate(row.created_at) };
}

/**
 * Build parameterised WHERE clause + params array from a filter object.
 * Returns { whereClause, params, nextIdx }.
 */
function buildWhere(filters, startIdx = 1) {
  const conditions = [];
  const params = [];
  let idx = startIdx;

  const add = (cond, val) => {
    conditions.push(cond.replace('?', `$${idx++}`));
    params.push(val);
  };

  if (filters.gender !== undefined) add('gender = ?', filters.gender);
  if (filters.age_group !== undefined) add('age_group = ?', filters.age_group);
  if (filters.country_id !== undefined)
    add('country_id = ?', filters.country_id.toUpperCase());
  if (filters.min_age !== undefined) add('age >= ?', filters.min_age);
  if (filters.max_age !== undefined) add('age <= ?', filters.max_age);
  if (filters.min_gender_probability !== undefined)
    add('gender_probability >= ?', filters.min_gender_probability);
  if (filters.min_country_probability !== undefined)
    add('country_probability >= ?', filters.min_country_probability);

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params, nextIdx: idx };
}

/** Run a paginated profiles query and send the JSON response. */
async function runProfilesQuery(res, filters, sortBy, orderDir, pageNum, limitNum) {
  const { whereClause, params, nextIdx } = buildWhere(filters);

  // Count
  const countResult = await db.query(
    `SELECT COUNT(*) FROM profiles ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data — safe to interpolate sortBy/orderDir because both are validated above
  const offset = (pageNum - 1) * limitNum;
  const dataResult = await db.query(
    `SELECT id, name, gender, gender_probability, age, age_group,
            country_id, country_name, country_probability, created_at
     FROM profiles
     ${whereClause}
     ORDER BY ${sortBy} ${orderDir.toUpperCase()}
     LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
    [...params, limitNum, offset]
  );

  return res.status(200).json({
    status: 'success',
    page: pageNum,
    limit: limitNum,
    total,
    data: dataResult.rows.map(formatRow),
  });
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /api/profiles
 * Full filtering, sorting, pagination.
 */
async function getAllProfiles(req, res) {
  try {
    // Reject unknown query params
    for (const key of Object.keys(req.query)) {
      if (!VALID_GET_PARAMS.has(key)) {
        return res
          .status(422)
          .json({ status: 'error', message: 'Invalid query parameters' });
      }
    }

    const {
      gender,
      age_group,
      country_id,
      min_age,
      max_age,
      min_gender_probability,
      min_country_probability,
      sort_by = 'created_at',
      order = 'asc',
      page = '1',
      limit = '10',
    } = req.query;

    // ── Validate enum-like params ──────────────────────────────────────────────
    if (gender !== undefined && !VALID_GENDERS.has(gender))
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });

    if (age_group !== undefined && !VALID_AGE_GROUPS.has(age_group))
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });

    if (!VALID_SORT_BY.has(sort_by))
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });

    if (!VALID_ORDER.has(order))
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });

    // ── Validate pagination ────────────────────────────────────────────────────
    const pageNum = parseInt(page, 10);
    const limitRaw = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1)
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });
    if (isNaN(limitRaw) || limitRaw < 1)
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });

    const limitNum = Math.min(limitRaw, MAX_LIMIT);

    // ── Validate numeric params ────────────────────────────────────────────────
    const filters = {};
    if (gender !== undefined) filters.gender = gender;
    if (age_group !== undefined) filters.age_group = age_group;
    if (country_id !== undefined) filters.country_id = country_id;

    if (min_age !== undefined) {
      const v = parseInt(min_age, 10);
      if (isNaN(v) || v < 0)
        return res
          .status(422)
          .json({ status: 'error', message: 'Invalid query parameters' });
      filters.min_age = v;
    }
    if (max_age !== undefined) {
      const v = parseInt(max_age, 10);
      if (isNaN(v) || v < 0)
        return res
          .status(422)
          .json({ status: 'error', message: 'Invalid query parameters' });
      filters.max_age = v;
    }
    if (min_gender_probability !== undefined) {
      const v = parseFloat(min_gender_probability);
      if (isNaN(v) || v < 0 || v > 1)
        return res
          .status(422)
          .json({ status: 'error', message: 'Invalid query parameters' });
      filters.min_gender_probability = v;
    }
    if (min_country_probability !== undefined) {
      const v = parseFloat(min_country_probability);
      if (isNaN(v) || v < 0 || v > 1)
        return res
          .status(422)
          .json({ status: 'error', message: 'Invalid query parameters' });
      filters.min_country_probability = v;
    }

    return await runProfilesQuery(res, filters, sort_by, order, pageNum, limitNum);
  } catch (err) {
    console.error('[getAllProfiles]', err);
    return res
      .status(500)
      .json({ status: 'error', message: 'Internal server error' });
  }
}

/**
 * GET /api/profiles/search?q=...
 * Natural language query → structured filters → same pipeline.
 */
async function searchProfiles(req, res) {
  try {
    // Reject unknown query params
    for (const key of Object.keys(req.query)) {
      if (!VALID_SEARCH_PARAMS.has(key)) {
        return res
          .status(422)
          .json({ status: 'error', message: 'Invalid query parameters' });
      }
    }

    const { q, page = '1', limit = '10' } = req.query;

    // q is required
    if (q === undefined || q.trim() === '') {
      return res
        .status(400)
        .json({ status: 'error', message: 'Missing or empty query parameter: q' });
    }

    // Validate pagination
    const pageNum = parseInt(page, 10);
    const limitRaw = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1)
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });
    if (isNaN(limitRaw) || limitRaw < 1)
      return res
        .status(422)
        .json({ status: 'error', message: 'Invalid query parameters' });

    const limitNum = Math.min(limitRaw, MAX_LIMIT);

    // Parse NL query
    const filters = parseQuery(q);
    if (!filters) {
      return res
        .status(200)
        .json({ status: 'error', message: 'Unable to interpret query' });
    }

    return await runProfilesQuery(res, filters, 'created_at', 'asc', pageNum, limitNum);
  } catch (err) {
    console.error('[searchProfiles]', err);
    return res
      .status(500)
      .json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = { getAllProfiles, searchProfiles };
