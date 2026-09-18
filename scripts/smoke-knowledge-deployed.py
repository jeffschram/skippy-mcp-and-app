#!/usr/bin/env python3
"""Run deployed canonical paths in an isolated brain and remove its fixtures.
Requires Convex CLI admin access. Does not read or change the owner's records.
"""
import json
import subprocess
import uuid

marker = 'knowledge-verification:' + str(uuid.uuid4())
identity = json.dumps({'subject': marker, 'issuer': 'https://verification.invalid', 'email': 'verification@example.invalid'})


def run(function, args):
    command = ['pnpm', 'exec', 'convex', 'run', function, json.dumps(args)]
    if not function.startswith('knowledgeMigration:'):
        command += ['--identity', identity]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(function + ': ' + result.stderr[:2000])
    return json.loads(result.stdout)


brain = None
try:
    brain = run('auth:ensureViewer', {'brainDisplayName': marker})['brainInstanceId']
    created = []
    for kind, payload in [('note', {'title': 'Verification note', 'body': 'Known test content'}),
                          ('link', {'title': 'Verification link', 'url': 'https://example.invalid/direct', 'status': 'saved'}),
                          ('knowledgeObject', {'title': 'Verification object', 'objectType': 'reference', 'properties': {'test': True, 'body': 'Full structured reference text'}})]:
        direct = run('knowledge:ingestObject', {'brainInstanceId': brain, 'candidateEntityType': kind, 'candidatePayload': payload,
                     'rubricDecision': 'Isolated verification', 'sourceRefs': [{'sourceSystem': 'verification', 'messageId': kind}]})
        created.append(direct['entityId'])
        if kind == 'knowledgeObject':
            assert direct['entityType'] == 'note'
            notes = run('knowledge:listNotesForViewer', {})['notes']
            note = next(row for row in notes if row['_id'] == direct['entityId'])
            assert note['kind'] == 'note' and note['body'] == payload['properties']['body']
            assert note['properties'] == payload['properties']
        reviewed_payload = {**payload, 'title': payload['title'] + ' reviewed'}
        if kind == 'link':
            reviewed_payload['url'] = 'https://example.invalid/review'
        candidate = run('knowledge:submitCandidateObject', {'brainInstanceId': brain, 'candidateEntityType': kind, 'candidatePayload': reviewed_payload})
        approved = run('knowledge:approveTriageItem', {'triageItemId': candidate['triageItemId']})
        created.append(approved['entityRef']['entityId'])
        if kind == 'link':
            run('knowledge:updateLinkStatusForBrain', {'brainInstanceId': brain, 'linkId': direct['entityId'], 'status': 'read'})
            links = run('knowledge:listLinksForViewer', {})['links']
            assert any(row['_id'] == direct['entityId'] and row['status'] == 'read' for row in links)
        if kind == 'note':
            notes = run('knowledge:listNotesForViewer', {})['notes']
            assert any(row['_id'] == direct['entityId'] and row['body'] == payload['body'] and row['sourceRefIds'] for row in notes)
        print(kind + ': direct ingestion, review approval, and canonical pointer passed', flush=True)
    visible = run('knowledge:acceptedEntityOptionsForViewer', {})
    assert set(created).issubset({row['entityId'] for row in visible})
    memory = run('knowledge:recordMemoryForBrain', {'brainInstanceId': brain, 'content': 'Known memory content', 'title': 'Verification memory',
                 'rubricDecision': 'Isolated verification', 'reviewBehavior': 'submit_for_review',
                 'relatedEntityRefs': [{'entityType': 'note', 'entityId': created[0]}],
                 'sourceRefs': [{'sourceSystem': 'verification', 'messageId': 'memory'}]})
    run('knowledge:acceptMemoryForViewer', {'memoryId': memory['memoryId'], 'body': 'Updated memory content'})
    detail = run('knowledge:memoryDetailForBrain', {'brainInstanceId': brain, 'memoryId': memory['memoryId']})
    assert detail['memory']['body'] == 'Updated memory content'
    assert len(detail['relatedEntities']) == 1 and len(detail['sourceRefs']) == 1
    print('memory: capture, approval, update, provenance, and relationship read passed', flush=True)
    started = run('interviews:startForBrain', {'brainInstanceId': brain, 'kind': 'decision', 'title': 'Verification interview'})
    for _ in range(started['interview']['questionCount']):
        answered = run('interviews:answerCurrentQuestionForBrain', {'brainInstanceId': brain, 'interviewId': started['interviewId'], 'answerText': 'A test decision', 'createMemoryCandidate': True})
        if answered.get('memoryCandidateId'):
            detail = run('knowledge:memoryDetailForBrain', {'brainInstanceId': brain, 'memoryId': answered['memoryCandidateId']})
            assert detail['memory']['reviewState'] == 'pending_review'
            break
    else:
        raise AssertionError('No interview memory candidate')
    print('interview: canonical memory pointer and retrieval passed', flush=True)
    print('Deployed Knowledge smoke passed', flush=True)
finally:
    if brain:
        result = run('knowledgeMigration:cleanupVerificationBrain', {'brainInstanceId': brain, 'marker': marker})
        print('Removed isolated verification fixtures:', result['deleted'], flush=True)
