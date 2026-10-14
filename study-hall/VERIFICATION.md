# 검증 기록

검증일: 2026-10-14 (Asia/Seoul).

## 완료

- GitHub 저장소 `fnsrbs/Jaseub` main 연결 및 앱 소스만 업로드 완료.
- GitHub Actions의 테스트·빌드·Pages 배포 성공: https://github.com/fnsrbs/Jaseub/actions/runs/38578023290
- 가상 데이터 데모 배포 주소: https://fnsrbs.github.io/Jaseub/

- `npm test`: **25개 모두 통과**. PostgreSQL PGlite에서 실제 SQL/RPC 실행, Edge HTTP 핸들러 실행(외부 Auth 클라이언트 모킹), 계산 단위 검증.
- `npm run build`: TypeScript 검사 및 Vite production 빌드 통과.
- 저장소 하위 경로 `/study-hall-test/`를 지정한 빌드 통과. hash 라우트 사용.
- 브라우저 교사 대시보드의 72석·현재 12명/오늘 18명 표시, 학생별 상태 확인.
- 학생 로그인과 본인 정보, 다른 학생 이름이 없는 좌석 배치도 확인.
- 390×844 모바일 검증: 학생 홈과 배치도에서 document 가로 넘침 없음.
- 만료 QR 시연에서 실패 메시지와 기존 상태 유지 확인.
- 유효한 데모 QR로 퇴실 성공: 현재 12→11명, 오늘 출석 18명 유지. 재입실 후 현재 12명, 본인 이용 구간 2개 확인.
- 72명 좌석 추첨 미리보기의 선택 입력 72개와 기존 좌석 유지 확인, 취소 시 확정 버튼 제거 확인.
- 서버 쪽 관리자/학생 인증 범위, 세션·코드 해시, 만료 QR, 고유 제약, 원자적 요청 제한은 자동 테스트로 확인.

## 계정 또는 기기 설정 후 확인할 항목

- 실제 Supabase 프로젝트에 마이그레이션/Edge 함수 배포, Auth 관리자 등록 및 서버 secrets 설정.
- 실제 gateway의 JWT 검증·신뢰할 수 있는 IP 전달·허용 origin, 다중 DB 연결에서 동시 HTTP 요청. `tests/hosted-e2e.mjs` 제공, 미실행.
- 실제 휴대폰 카메라 권한 허용/거부 및 카메라 없는 기기의 안내, 현장 QR 스캔. 카메라 하드웨어/권한 테스트는 미실행.
- 운영 DB 백업·복구 연습. 공식 문서에 기반한 절차 제공, 미실행.

PGlite는 PostgreSQL의 단일 엔진을 사용하므로 Promise 병렬 호출 검증은 실제 여러 연결 사이의 경합 검증과 다릅니다. Edge 테스트는 외부 Auth와 DB 연결을 모킹하며, 별도 DB 테스트에서 서버 RPC의 권한과 저장 동작을 검증합니다. 데모 브라우저 시연은 실제 DB 연결 완료를 의미하지 않습니다.
