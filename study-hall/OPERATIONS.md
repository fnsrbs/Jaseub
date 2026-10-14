# 운영 연결 상태

설정일: 2026-10-14 / Asia-Seoul.

- 웹앱: https://fnsrbs.github.io/Jaseub/
- Supabase 프로젝트: `Jaseub`, `nrkjdkpcpmzlanjcwjnw`, Seoul / ap-northeast-2.
- Dashboard: https://supabase.com/dashboard/project/nrkjdkpcpmzlanjcwjnw
- 조직: Gyun2, Free 플랜. 유료 플랜 전환은 하지 않았습니다.
- DB 마이그레이션 두 개 및 Edge `api` 배포 완료. 파일 버전은 실제 DB 적용 기록과 일치합니다.
- 학생 코드 비밀값은 DB에서 생성해 Vault에 암호화 보관하며, service_role 전용 RPC로 해시만 계산합니다. 저장소에는 비밀값이 없습니다.
- GitHub Actions 변수는 `production`, 프로젝트 API URL, 공개 publishable 키입니다. service_role 키는 GitHub에 설정하지 않습니다.
- 초기 상태: 교사 관리자 1명, 예시 좌석 72개, 정원 72명. 실제 학생 0명. 임시 검증 학생·출결·건의·QR은 정리했습니다.

## 처음 사용

1. 웹앱에서 **교사**를 선택하고 Supabase에 직접 설정한 이메일·비밀번호로 로그인합니다. 계정 UUID에 관리자 권한이 연결되어 있습니다.
2. 학생을 등록하고 무작위 접속 코드를 발급해 개별 전달합니다. 기본 데모 코드는 운영 사이트에서 사용할 수 없습니다.
3. 좌석을 배정하고, 수능 날짜·운영일·출석 대상·기준 시각을 설정합니다.
4. 교사 화면의 **현장 QR**을 교실에 표시합니다. 실제 휴대폰에서 입실·퇴실 카메라 스캔을 최종 확인합니다.
5. 필요시 Authentication의 공개 회원가입을 끕니다. 앱에는 회원가입 기능이 없으며, Auth 계정만 생성한 사용자는 관리자 권한을 얻을 수 없습니다.

## 확인한 범위

실제 HTTP API로 학생 코드 인증, 개인 기록·건의 분리, 학생의 관리자 기능 거부, 12개 동시 입실 중 1건 저장, 동일 요청 재전송, 중복 퇴실 거부, 별도 재입실 구간, 만료 QR, 위조 세션, 공개 REST의 학생 테이블 접근 차단을 검증했습니다. 코드 재발급·이용 중지 후 기존 세션의 접근 거부와 기록 보존도 확인했습니다.

Supabase 보안 Advisor 경고는 0건입니다. 교사 계정의 비밀번호는 사용자가 직접 설정했고 에이전트는 수집하지 않았으므로, 정상 교사 로그인과 실제 휴대폰 카메라는 소유자가 마지막으로 확인할 항목입니다. 일반 운영 학생의 데이터는 검증 목적으로 삭제하지 않습니다.

백업·복구와 Free 사용량 제한은 [README](README.md)를 따릅니다. Vault의 비밀값을 다른 프로젝트로 복원할 때에는 [Vault 공식 복구 관련 설명](https://supabase.com/docs/guides/database/vault)을 확인하세요. 키를 복구할 수 없으면 학생 접속 코드를 재발급해야 합니다.
