# Insighta Query Engine

A Node.js/Express REST API for querying demographic profile data with advanced filtering, sorting, pagination, and natural-language search.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Create the table and indexes
npm run migrate

# 4. Seed the database (place profiles.json in ./data/ first)
npm run seed
# Or pass a custom path:
node scripts/seed.js /path/to/profiles.json

# 5. Start the server
npm start
```

---

## Environment Variables

| Variable       | Description                             |
|----------------|-----------------------------------------|
| `DATABASE_URL` | PostgreSQL connection string            |
| `PORT`         | Server port (default: 3000)             |
| `NODE_ENV`     | `development` or `production`           |

---

## Endpoints

### `GET /api/profiles`

Returns all profiles with optional filtering, sorting, and pagination.

**Query Parameters**

| Param                    | Type    | Default      | Notes                                 |
|--------------------------|---------|--------------|---------------------------------------|
| `gender`                 | string  | —            | `male` or `female`                    |
| `age_group`              | string  | —            | `child`, `teenager`, `adult`, `senior`|
| `country_id`             | string  | —            | ISO 3166-1 alpha-2 code (e.g. `NG`)   |
| `min_age`                | integer | —            | Inclusive lower bound                 |
| `max_age`                | integer | —            | Inclusive upper bound                 |
| `min_gender_probability` | float   | —            | 0.0 – 1.0                             |
| `min_country_probability`| float   | —            | 0.0 – 1.0                             |
| `sort_by`                | string  | `created_at` | `age`, `created_at`, `gender_probability` |
| `order`                  | string  | `asc`        | `asc` or `desc`                       |
| `page`                   | integer | `1`          | ≥ 1                                   |
| `limit`                  | integer | `10`         | 1 – 50 (capped at 50)                 |

All filters are combinable; results must match every condition passed.

**Example**
```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

**Success Response (200)**
```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 312,
  "data": [
    {
      "id": "b3f9c1e2-...",
      "name": "emmanuel",
      "gender": "male",
      "gender_probability": 0.99,
      "age": 34,
      "age_group": "adult",
      "country_id": "NG",
      "country_name": "Nigeria",
      "country_probability": 0.85,
      "created_at": "2026-04-01T12:00:00Z"
    }
  ]
}
```

---

### `GET /api/profiles/search`

Converts a plain-English query into structured filters and returns matching profiles.

**Query Parameters**

| Param   | Required | Notes                     |
|---------|----------|---------------------------|
| `q`     | ✅       | Plain-English search query |
| `page`  | —        | Same as `/api/profiles`   |
| `limit` | —        | Same as `/api/profiles`   |

**Example**
```
GET /api/profiles/search?q=young males from nigeria
```

**Uninterpretable query (200)**
```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

## Natural Language Parsing Approach

The parser is **purely rule-based** (no AI, no LLMs). It applies a sequence of deterministic regex passes to the lowercased query string.

### 1 — Gender detection

| Pattern                                        | Maps to        |
|------------------------------------------------|----------------|
| `male`, `males`, `man`, `men`, `boy`, `boys`   | `gender=male`  |
| `female`, `females`, `woman`, `women`, `girl`, `girls` | `gender=female` |
| Both patterns present                          | No gender filter |

### 2 — Age group detection

| Pattern                                        | Maps to                  |
|------------------------------------------------|--------------------------|
| `child`, `children`, `kids`, `kid`             | `age_group=child`        |
| `teenager`, `teen`, `teenagers`, `teens`, `adolescent` | `age_group=teenager` |
| `adult`, `adults`                              | `age_group=adult`        |
| `senior`, `seniors`, `elderly`                 | `age_group=senior`       |

### 3 — The `young` keyword

`young` maps to **`min_age=16`, `max_age=24`** for parsing purposes only. It does **not** set `age_group`. It is not a stored age group value.

### 4 — Explicit age modifiers

Modifiers override the `young` range if both appear.

| Pattern                                            | Effect              |
|----------------------------------------------------|---------------------|
| `above N`, `over N`, `older than N`, `at least N`  | `min_age=N`         |
| `below N`, `under N`, `younger than N`, `at most N`| `max_age=N`         |
| `between N and M`                                  | `min_age=N, max_age=M` |

### 5 — Country detection

The parser looks for `from [name]` or `in [name]` and resolves the country name against a built-in table of ~120 country names/aliases (see `src/utils/countries.js`). Multi-word names (e.g. `south africa`, `burkina faso`) are resolved using a **longest-match-first** strategy.

### Supported example mappings

| Query                                | Extracted Filters                                          |
|--------------------------------------|------------------------------------------------------------|
| `young males`                        | `gender=male, min_age=16, max_age=24`                      |
| `females above 30`                   | `gender=female, min_age=30`                                |
| `people from angola`                 | `country_id=AO`                                            |
| `adult males from kenya`             | `gender=male, age_group=adult, country_id=KE`              |
| `male and female teenagers above 17` | `age_group=teenager, min_age=17`                           |
| `young males from nigeria`           | `gender=male, min_age=16, max_age=24, country_id=NG`       |
| `senior women in ghana`              | `gender=female, age_group=senior, country_id=GH`           |
| `children below 10`                  | `age_group=child, max_age=10`                              |
| `adults between 25 and 40`           | `age_group=adult, min_age=25, max_age=40`                  |

---

## Limitations & Known Edge Cases

1. **No OR logic** — The parser cannot handle `from Nigeria or Ghana`. Only AND semantics are supported. Every extracted filter is combined with AND.

2. **No negation** — Queries like `not from Nigeria` or `adults who are not male` are not supported. The negative word is silently ignored.

3. **Country name must be spelltable** — Fuzzy matching is not implemented. `Nigria` will not resolve. Only exact matches (or listed aliases) succeed.

4. **Ambiguous `congo`** — `congo` resolves to the Republic of the Congo (`CG`). To target the DRC, use `democratic republic of congo` or `dr congo`.

5. **`young` + explicit modifier** — If someone writes `young adults above 30`, the `young` sets `min_age=16, max_age=24` but `above 30` then overrides `min_age=30`. The final result is `min_age=30, max_age=24`, which returns 0 rows (contradictory range). This is an inherent tension in combining these keywords.

6. **No multi-country support** — `from Nigeria and Kenya` will try to match `nigeria and kenya` as a country name, fail, and return no country filter.

7. **No age-group inference from `young`** — `young` does not infer `age_group=teenager` or any stored group. It only sets a numeric age range.

8. **Relative terms without a number** — Phrases like `very old` or `quite young` are not parsed to any age range. Only `young` (as a standalone keyword) has a defined mapping.

9. **Partial word collisions** — The word `mangrove` contains `man` but the parser uses word-boundary anchors (`\b`), so this is safe.

10. **`q` parameter only** — The search endpoint does not support combining `q` with additional filter query params (`gender=`, `country_id=`, etc.). Those are the domain of `GET /api/profiles`.

---

## Error Responses

All errors follow:
```json
{ "status": "error", "message": "<description>" }
```

| Status | Trigger                                              |
|--------|------------------------------------------------------|
| 400    | Missing or empty required parameter (`q`)            |
| 422    | Invalid parameter type or value; unknown query param |
| 404    | Route not found                                      |
| 500    | Unexpected server or database error                  |

---

## Database Schema

```sql
CREATE TABLE profiles (
  id                  VARCHAR(36)              PRIMARY KEY,  -- UUID v7
  name                VARCHAR                  NOT NULL UNIQUE,
  gender              VARCHAR                  NOT NULL,
  gender_probability  FLOAT                    NOT NULL,
  age                 INT                      NOT NULL,
  age_group           VARCHAR                  NOT NULL,
  country_id          VARCHAR(2)               NOT NULL,
  country_name        VARCHAR                  NOT NULL,
  country_probability FLOAT                    NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

Indexes exist on: `gender`, `age`, `age_group`, `country_id`, `gender_probability`, `country_probability`, `created_at`.

---

## Performance Notes

- All filter columns are indexed; filtered queries never require a full table scan.
- The seed script batches inserts (100 rows per statement) to minimise round-trips.
- `ON CONFLICT (name) DO NOTHING` makes re-seeding completely safe and fast.
- `sort_by` column names are validated against an allowlist before interpolation (SQL-injection safe).

---

## Deployment Checklist

- [ ] `DATABASE_URL` set in environment
- [ ] `npm run migrate` executed (creates table + indexes)
- [ ] `npm run seed` executed with profiles.json
- [ ] `Access-Control-Allow-Origin: *` header verified (curl -I)
- [ ] All endpoints tested from at least two networks
