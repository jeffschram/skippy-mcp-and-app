#!/usr/bin/env python3
"""Independently compare private Convex exports; print counts, never content."""
import argparse
import collections
import json
import zipfile

LEGACY = {"notes": "note", "links": "link", "knowledgeObjects": "knowledgeObject", "memories": "memory"}


def read_snapshot(path):
    with zipfile.ZipFile(path) as archive:
        return {name.split('/')[0]: [json.loads(line) for line in archive.read(name).splitlines()]
                for name in archive.namelist() if name.endswith('/documents.jsonl') and name.count('/') == 1}


def audit(before, after):
    failures = collections.Counter()
    old = {row['_id']: (kind, row) for table, kind in LEGACY.items() for row in before[table]}
    canonical = {row['_id']: row for row in after['knowledge']}
    prior = {row['_id']: row for row in before['knowledge']}
    mapping = {}
    for row in canonical.values():
        for source_id in set([row.get('legacyId'), *row.get('legacyIds', [])]) - {None}:
            if source_id in mapping and mapping[source_id] != row['_id']:
                failures['ambiguous mapping'] += 1
            mapping[source_id] = row['_id']
    def rewrite(value):
        if isinstance(value, str):
            return mapping.get(value, value)
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        return value
    grouped = collections.defaultdict(list)
    for old_id, (kind, row) in old.items():
        target = canonical.get(mapping.get(old_id))
        if not target:
            failures['unmapped legacy record'] += 1
            continue
        if target['kind'] != kind or target['brainInstanceId'] != row['brainInstanceId']:
            failures['wrong kind or brain'] += 1
        grouped[target['_id']].append(row)
    # Existing canonical values must survive, even if old history disagrees.
    for row_id, row in prior.items():
        target = canonical.get(row_id)
        if target is None:
            failures['existing canonical record removed'] += 1
            continue
        for key, value in row.items():
            if key in ('legacyId', 'legacyIds'):
                continue
            expected = value if key in ('_id', '_creationTime') else rewrite(value)
            if key == 'sourceRefIds':
                if not set(expected).issubset(target.get(key, [])):
                    failures['canonical provenance lost'] += 1
            elif target.get(key) != expected:
                failures['existing canonical field changed: ' + key] += 1
    # New single-source records must preserve every legacy field. For duplicate
    # links, the most recently updated legacy row is authoritative; preexisting
    # canonical links were checked above and take precedence.
    for target_id, sources in grouped.items():
        if target_id in prior:
            continue
        source = max(sources, key=lambda row: row['updatedAt'])
        target = canonical[target_id]
        for key, value in source.items():
            if key in ('_id', '_creationTime', 'relatedEntityRefs'):
                continue
            if target.get(key) != rewrite(value):
                failures['legacy field differs: ' + key] += 1
        if target['kind'] == 'memory':
            expected = 'suggested' if source['status'] == 'inbox' else source['status']
            if target['processingState'] != expected:
                failures['memory processing state differs'] += 1
    edges = {(row['brainInstanceId'], row['from']['entityId'], row['to']['entityType'], row['to']['entityId'])
             for row in after.get('relationships', []) if row['type'] == 'mentions'}
    for old_id, (_, row) in old.items():
        for ref in row.get('relatedEntityRefs', []):
            expected = (row['brainInstanceId'], mapping.get(old_id), ref['entityType'], mapping.get(ref['entityId'], ref['entityId']))
            if expected not in edges:
                failures['missing memory relationship'] += 1
    # Every exact old-ID reference outside provenance and legacy tables must go.
    def scan(value):
        if isinstance(value, str) and value in old:
            failures['remaining legacy ID reference'] += 1
        elif isinstance(value, list):
            for item in value:
                scan(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key not in ('legacyId', 'legacyIds'):
                    scan(item)
    for table, rows in after.items():
        if table not in LEGACY:
            for row in rows:
                scan(row)
    print(json.dumps({'legacyRecords': len(old), 'mappedLegacyRecords': sum(key in mapping for key in old),
                      'canonicalBefore': len(prior), 'canonicalAfter': len(canonical),
                      'distinctMigrationTargets': len(grouped), 'mergedTargets': sum(len(rows) > 1 for rows in grouped.values()),
                      'failures': dict(failures)}, indent=2))
    return not failures


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', required=True)
    parser.add_argument('--after', required=True)
    args = parser.parse_args()
    raise SystemExit(0 if audit(read_snapshot(args.before), read_snapshot(args.after)) else 1)
