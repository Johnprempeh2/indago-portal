"""One-time extractor for the approved NS-01 DOCX. Run only with the source attachment."""

import json
import sys
import zipfile
from xml.etree import ElementTree as ET


root = ET.fromstring(zipfile.ZipFile(sys.argv[1]).read('word/document.xml'))
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
paragraphs = [
    ''.join(text.text or '' for text in paragraph.findall('.//w:t', ns))
    for paragraph in root.findall('.//w:p', ns)
]

seed = {
    'id': 'IND-NS-001',
    'edition': paragraphs[2],
    'purpose': paragraphs[3],
    'guardrails': paragraphs[5:10],
    'baseline': [
        {'id': paragraphs[i].split(':')[0].replace(' and 082', '/082'),
         'proposition': paragraphs[i], 'treatment': paragraphs[i + 1]}
        for i in range(13, 27, 2)
    ],
    'baselineNote': paragraphs[27],
    'runOfShow': [
        {'time': paragraphs[i], 'move': paragraphs[i + 1], 'outcome': paragraphs[i + 2]}
        for i in range(32, 53, 3)
    ],
    'questions': [
        {'heading': paragraphs[start], 'items': paragraphs[start + 1:end]}
        for start, end in [(54, 59), (59, 65), (65, 71), (71, 76), (76, 81), (81, 86)]
    ],
    'futures': [
        {'name': paragraphs[i], 'provocation': paragraphs[i + 1], 'evidence': paragraphs[i + 2]}
        for i in range(90, 99, 3)
    ],
    'futuresAsk': paragraphs[99],
    'sentenceAid': paragraphs[101],
    'dimensions': [paragraphs[i] for i in range(116, 145, 4)],
    'boundary': [paragraphs[i] for i in range(151, 164, 2)],
    'convergence': paragraphs[166:173],
    'hypotheses': [paragraphs[i] for i in range(180, 211, 6)],
    'recommendedRequests': paragraphs[216].split(': ', 1)[1].rstrip('.').split('; '),
    'important': paragraphs[236],
}
print(json.dumps(seed, ensure_ascii=False, indent=2))
