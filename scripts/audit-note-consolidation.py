#!/usr/bin/env python3
"""Verify note consolidation from private Convex snapshots without printing content."""
import argparse
import collections
import json
import zipfile


def load(path):
    with zipfile.ZipFile(path) as archive:
        return {name.split('/')[0]: [json.loads(line) for line in archive.read(name).splitlines()]
                for name in archive.namelist() if name.endswith('/documents.jsonl') and name.count('/') == 1}


def audit(before, after):
    targets = {row['_id']: row for row in before['knowledge']}
    failures = collections.Counter()
    changed = collections.Counter()

    def expected(value):
        if isinstance(value, list):
            return [expected(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {key: expected(item) for key, item in value.items()}
        if value.get('entityType') == 'knowledgeObject':
            target = targets.get(value.get('entityId'))
            if not target:
                failures['unknown reference target'] += 1
            else:
                result['entityType'] = 'memory' if target['kind'] == 'memory' else 'note'
        return result

    def text(*values):
        return next((v for v in values if isinstance(v, str) and v.strip()), None)

    for table in ['knowledge', 'relationships', 'entitySourceRefs', 'activityEvents']:
        current = {row['_id']: row for row in after[table]}
        for row in before[table]:
            wanted = expected(row)
            if table == 'knowledge' and row['kind'] == 'knowledgeObject':
                properties = row.get('properties') or {}
                wanted['kind'] = 'note'
                wanted['title'] = text(row.get('title'), properties.get('title'))
                wanted['body'] = text(row.get('body'), properties.get('body'), properties.get('text'), row.get('summary'), properties.get('sourceSummary'), row.get('title')) or ''
                summary = text(row.get('summary'), properties.get('sourceSummary'))
                if summary is not None:
                    wanted['summary'] = summary
                changed['convertedNotes'] += 1
            if wanted != current.get(row['_id']):
                failures[table + ': record mismatch'] += 1
            elif wanted != row:
                changed[table + ': verified changed records'] += 1

    def stale(value):
        if isinstance(value, list):
            return sum(stale(item) for item in value)
        if isinstance(value, dict):
            return sum(1 for key in ['kind', 'entityType', 'candidateEntityType'] if value.get(key) == 'knowledgeObject') + sum(stale(item) for item in value.values())
        return 0

    remaining = sum(stale(row) for rows in after.values() for row in rows)
    if remaining:
        failures['remaining legacy classifications'] = remaining
    print(json.dumps({'verified': dict(changed), 'failures': dict(failures)}, indent=2))
    return not failures


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', required=True)
    parser.add_argument('--after', required=True)
    args = parser.parse_args()
    raise SystemExit(0 if audit(load(args.before), load(args.after)) else 1)
