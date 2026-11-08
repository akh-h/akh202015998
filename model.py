import json, io
import numpy as np
import openpyxl
book = None

def emit(x):
    return json.dumps(x, ensure_ascii=False, allow_nan=False)

def initialize(raw):
    global book, codes, names, L, M, V, sheets, valid
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    book = {s: list(wb[s].values) for s in wb.sheetnames}
    wb.close()
    sheets = list(book)
    base = book['국산투입계수(Ad)']
    
    # 대분류(A, C01 등 영문포함 33부문), 중분류(83부문), 소분류(165부문), 기본부문(380부문) 모두 인식
    codes = [
        str(c).strip() for c in base[4][2:]
        if c is not None and str(c).strip() != '' and not (str(c).strip().isdigit() and int(str(c).strip()) >= 9000)
    ]
    if len(codes) == 0 or len(set(codes)) != len(codes):
        raise ValueError('유효한 산업 부문 코드를 찾을 수 없습니다.')
        
    nm = {str(r[0]).strip(): str(r[1]).strip() for r in base[6:] if r and r[0] is not None and r[1] is not None}
    names = [nm[c] for c in codes]
    
    def matrix(s):
        rows = book[s]
        ri = {str(r[0]).strip(): i for i, r in enumerate(rows) if r and r[0] is not None}
        ci = {str(c).strip(): i for i, c in enumerate(rows[4]) if c is not None}
        a = np.array([[rows[ri[c]][ci[k]] for k in codes] for c in codes], dtype=float)
        if not np.isfinite(a).all():
            raise ValueError(s + ': 비수치 또는 결측 데이터')
        return a

    L = matrix('생산유발계수')
    M = matrix('수입유발계수')
    V = matrix('부가가치유발계수')
    ad = matrix('국산투입계수(Ad)')
    am = matrix('수입투입계수(Am)')
    
    rows = book['총투입계수(A)']
    ci = {str(c).strip(): i for i, c in enumerate(rows[4]) if c is not None}
    vr = next(r for r in rows if r and str(r[0]).strip() == '9690')
    v = np.array([vr[ci[c]] for c in codes], dtype=float)
    
    residuals = {
        '생산': float(np.max(np.abs((np.eye(len(codes)) - ad) @ L - np.eye(len(codes))))),
        '수입': float(np.max(np.abs(am @ L - M))),
        '부가가치': float(np.max(np.abs(v[:, None] * L - V)))
    }
    valid = max(residuals.values()) < 1e-8
    if not valid:
        raise ValueError('계수 검증 실패: ' + str(residuals))
        
    # 산업연관분석 확장: 산업별 유발계수 열합 및 영향력계수(후방연쇄)·감응도계수(전방연쇄) 산출
    col_sums = L.sum(axis=0)
    row_sums = L.sum(axis=1)
    mean_L = float(col_sums.mean())
    b_idx = col_sums / mean_L
    f_idx = row_sums / mean_L
    m_sums = M.sum(axis=0)
    v_sums = V.sum(axis=0)
    
    linkage = []
    for i, (c, n) in enumerate(zip(codes, names)):
        bi, fi = float(b_idx[i]), float(f_idx[i])
        if bi >= 1.0 and fi >= 1.0:
            ltype = '전·후방 연쇄효과 모두 높음 (중간재 제조업형)'
        elif bi >= 1.0 and fi < 1.0:
            ltype = '후방연쇄효과 높음 (최종수요 제조업형)'
        elif bi < 1.0 and fi >= 1.0:
            ltype = '전방연쇄효과 높음 (원자재·기초투입형)'
        else:
            ltype = '전·후방 연쇄효과 모두 낮음 (최종수요 서비스형)'
        linkage.append({
            'code': c, 'name': n,
            'prodCoef': float(col_sums[i]),
            'impCoef': float(m_sums[i]),
            'vaCoef': float(v_sums[i]),
            'backward': bi,
            'forward': fi,
            'type': ltype
        })
        
    return emit({
        'sectors': [{'code': c, 'name': n} for c, n in zip(codes, names)],
        'sheets': sheets,
        'residuals': residuals,
        'linkage': linkage
    })

def explore(sheet, rowcode):
    rows = book[sheet]
    choices = [{'code': str(r[0]).strip(), 'name': str(r[1]).strip()} for r in rows[6:] if len(r) > 1 and r[0] is not None and r[1] is not None]
    chosen = next((r for r in rows[6:] if r and r[0] is not None and str(r[0]).strip() == rowcode), None)
    if chosen is None:
        chosen = next(r for r in rows[6:] if r and r[0] is not None and r[1] is not None)
    cells = []
    for i in range(2, len(rows[4])):
        if rows[4][i] is None:
            continue
        val = chosen[i] if i < len(chosen) else None
        if isinstance(val, (float, int)):
            val = float(val)
        elif val is not None:
            val = str(val)
        cells.append({'code': str(rows[4][i]).strip(), 'name': str(rows[5][i] or '').strip(), 'value': val})
        
    raw_unit = str(rows[3][0] or '').strip()
    row_name = str(chosen[1]).strip()
    if '구성비' in row_name:
        unit_desc = '단위 : % (백분율 비중)'
    elif '영향력' in row_name or '감응도' in row_name:
        unit_desc = '단위 : 상대지수 (전 산업 평균 = 1.0 기준)'
    elif '유발계수' in row_name:
        unit_desc = '단위 : 계수 (최종수요 1단위당 유발 비율, 무단위)'
    elif '백만원' in raw_unit:
        unit_desc = '단위 : 백만원 (금액표 원자료 기준)'
    else:
        unit_desc = '단위 : 계수 / 비율 (산출 1단위당 또는 최종수요 1단위당 비율, 무단위)'
        
    return emit({
        'rows': choices,
        'selected': str(chosen[0]).strip(),
        'name': row_name,
        'unit': unit_desc,
        'cells': cells
    })

def simulate(payload):
    if not valid:
        raise ValueError('검증된 데이터가 없습니다.')
    shocks = json.loads(payload)
    f = np.zeros(len(codes))
    for s in shocks:
        a = float(s['amount'])
        if not np.isfinite(a) or a < 0:
            raise ValueError('수요 증가액은 유한한 0 이상의 수여야 합니다.')
        f[codes.index(s['code'])] += a
    if not f.sum() > 0:
        raise ValueError('한 산업 이상의 양의 수요 증가액을 입력하세요.')
    x = L @ f
    m = M @ f
    v = V @ f
    result = [{
        'code': c, 'name': n,
        'production': float(a), 'imports': float(b), 'valueAdded': float(d)
    } for c, n, a, b, d in zip(codes, names, x, m, v)]
    result.sort(key=lambda r: r['production'], reverse=True)
    return emit({
        'demand': float(f.sum()),
        'production': float(x.sum()),
        'imports': float(m.sum()),
        'valueAdded': float(v.sum()),
        'multiplier': float(x.sum() / f.sum()),
        'rows': result
    })
