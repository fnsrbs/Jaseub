# 온실 · 자습실 출결 및 좌석 관리

React·TypeScript·Vite 앱이며 배포 사이트는 실제 Supabase Auth·Postgres·Edge Functions에 연결되어 있습니다. 로컬 데모는 가상 학생 72명으로 실행할 수 있습니다.

- [전체 설치·Supabase·관리자 등록·백업 안내](study-hall/README.md)
- [검증 결과와 운영 전 확인 사항](study-hall/VERIFICATION.md)
- [GitHub Actions 배포 상태](https://github.com/fnsrbs/Jaseub/actions)
- [운영 앱](https://fnsrbs.github.io/Jaseub/)
- [현재 운영 연결 상태](study-hall/OPERATIONS.md)

## 로컬 실행

```sh
cd study-hall
npm ci
npm run dev
```

환경변수 없이 복제한 코드는 데모로 실행됩니다. 데모 학생 코드: `DEMO-STUDENT-0001`. 관리자 탭은 가상 명단을 관리합니다. 교사 탭은 코드로 조회만 합니다. 운영 사이트에서는 Supabase 관리자 계정과 발급된 실제 학생 코드로 로그인합니다.

## 배포와 운영 모드

GitHub Pages Source를 **GitHub Actions**로 설정하면 `main` 변경 시 테스트와 빌드 후 배포합니다. 저장소 하위 경로와 hash 라우팅을 사용합니다.

현재 배포 변수는 운영 모드로 설정합니다. Repository → Settings → Secrets and variables → Actions → Variables에서 `VITE_APP_MODE=production`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 관리합니다. 마지막 값은 공개 publishable 키입니다. 서버 비밀값은 Supabase Vault 및 서버 환경에만 보관합니다.

이 저장소는 앱 소스와 배포 설정만 포함합니다. 실제 명단·출력 파일·DB 백업·개인 코드·비밀키는 업로드하지 않습니다.
