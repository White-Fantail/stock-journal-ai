"""Private P4 exception taxonomy; never expose arbitrary provider error text.

Classification describes the evidence work needed to unblock an account.
It never certifies source coverage and never alters the reconciliation result.
Unknown codes fail to the most restrictive category/severity.
"""
from __future__ import annotations
from dataclasses import dataclass
import re

_VALID=re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
_CATEGORIES=frozenset(("COVERAGE","EXECUTION","FEES","CORPORATE_ACTION",
                        "CASH","SNAPSHOT","AUTHORIZATION","INTEGRITY"))
_SCOPES=frozenset(("ACCOUNT","WINDOW","EXECUTION","SNAPSHOT"))
# code: category, scope, user-facing safe Korean explanation
_CATALOG={
 "HISTORY_GAP":("COVERAGE","WINDOW","요청한 기간의 체결 이력에 빈 구간이 있습니다."),
 "HISTORY_COVERAGE_UNVERIFIED":("COVERAGE","WINDOW","수집된 기간이 전체 이력을 포함하는지 확인해야 합니다."),
 "EXECUTION_OUTSIDE_CERTIFIED_WINDOW":("COVERAGE","WINDOW","체결 시각이 검증된 수집 구간 밖에 있습니다."),
 "EXECUTION_OUT_OF_RANGE":("COVERAGE","WINDOW","체결 시각이 요청한 범위를 벗어났습니다."),
 "SOURCE_VERSION_CONFLICT":("EXECUTION","EXECUTION","같은 체결 식별자에 서로 다른 데이터가 존재합니다."),
 "POTENTIAL_DUPLICATE_FILL":("EXECUTION","EXECUTION","중복 체결로 의심되는 기록이 존재합니다."),
 "AMBIGUOUS_FILL_SEQUENCE":("EXECUTION","EXECUTION","체결의 선후 관계를 확인해야 합니다."),
 "INVALID_EXECUTION":("EXECUTION","EXECUTION","체결의 일부 필드가 검증되지 않았습니다."),
 "INSUFFICIENT_OPEN_LOTS":("EXECUTION","EXECUTION","매도 수량의 취득 이력에 누락 가능성이 있습니다."),
 "FEE_UNKNOWN":("FEES","EXECUTION","체결 수수료를 확인할 수 없습니다."),
 "FEE_CURRENCY_UNVERIFIED":("FEES","EXECUTION","수수료 통화가 거래 통화와 일치하는지 확인해야 합니다."),
 "ORDERS_UNVERIFIED":("EXECUTION","ACCOUNT","주문과 체결 기록의 대조가 필요합니다."),
 "CASH_ACTIVITY_UNVERIFIED":("CASH","ACCOUNT","입출금·배당 등 현금활동의 대조가 필요합니다."),
 "CORPORATE_ACTIONS_UNVERIFIED":("CORPORATE_ACTION","ACCOUNT","분할 등 기업행동 이력의 대조가 필요합니다."),
 "POSITION_QUANTITY_MISMATCH":("SNAPSHOT","SNAPSHOT","계산된 보유수량과 증권사 기록이 다릅니다."),
 "SNAPSHOT_UNAVAILABLE":("SNAPSHOT","SNAPSHOT","동일 시각의 증권사 보유수량 자료가 없습니다."),
 "SNAPSHOT_ASOF_MISMATCH":("SNAPSHOT","SNAPSHOT","보유수량 자료의 기준 시각이 다릅니다."),
 "SNAPSHOT_UNVERIFIED":("SNAPSHOT","SNAPSHOT","보유수량 자료의 출처가 확인되지 않았습니다."),
 "SNAPSHOT_INVALID":("SNAPSHOT","SNAPSHOT","보유수량 자료의 형식이 유효하지 않습니다."),
 "SNAPSHOT_DUPLICATE_SYMBOL":("SNAPSHOT","SNAPSHOT","중복된 종목·통화 자료가 있습니다."),
 "INDEPENDENT_ATTESTATION_REQUIRED":("AUTHORIZATION","ACCOUNT","독립적인 거래이력 검증 증명이 필요합니다."),
 "SOURCE_EVIDENCE_MISSING":("INTEGRITY","EXECUTION","이 체결에 연결되는 암호화된 원본 증거가 없습니다."),
 "SOURCE_EVIDENCE_CONFLICT":("INTEGRITY","EXECUTION","같은 체결에 서로 다른 원본 증거가 있습니다."),
 "SOURCE_CONTRACT_INVALID":("INTEGRITY","ACCOUNT","입력 증거의 검증 형식이 일치하지 않습니다."),
 "INVALID_SOURCE":("INTEGRITY","ACCOUNT","증거 자료의 형식이 유효하지 않습니다."),
 "INVALID_WINDOW":("COVERAGE","WINDOW","이력 구간의 경계가 유효하지 않습니다."),
 "INVALID_INTERVAL":("COVERAGE","WINDOW","조회 시작·종료 시간이 유효하지 않습니다."),
 "INVALID_EXECUTION":("EXECUTION","EXECUTION","체결의 일부 필드가 검증되지 않았습니다."),
 "INVALID_SOURCE_ID":("INTEGRITY","EXECUTION","체결 식별자를 검증할 수 없습니다."),
 "UNVERIFIED_EXECUTION":("EXECUTION","EXECUTION","체결내역을 독립적으로 검증해야 합니다."),
 "CONFLICTING_SOURCE_VERSION":("INTEGRITY","EXECUTION","동일 식별자의 체결 버전이 충돌합니다."),
 "PROJECTION_UNAVAILABLE":("INTEGRITY","ACCOUNT","현재 자료로 신뢰할 수 있는 손익을 산출할 수 없습니다."),
}

@dataclass(frozen=True)
class Issue:
    code: str
    category: str
    severity: str
    scope: str
    message: str


def classify(code:str)->Issue:
    if not isinstance(code,str) or not _VALID.fullmatch(code):
        raise ValueError("INVALID_ISSUE_CODE")
    category,scope,message=_CATALOG.get(
        code,("INTEGRITY","ACCOUNT","추가적인 데이터 출처 검증이 필요합니다."))
    # Every issue produced by the strict P4 gate blocks financial publication.
    assert category in _CATEGORIES and scope in _SCOPES
    return Issue(code,category,"BLOCKER",scope,message)


def summaries(codes):
    """DTO-safe bounded output, no raw Tiger payloads, account IDs or secrets."""
    if not isinstance(codes,(list,tuple,set)) or len(codes)>64:
        raise ValueError("INVALID_ISSUE_SET")
    return tuple(classify(code) for code in sorted(set(codes)))
