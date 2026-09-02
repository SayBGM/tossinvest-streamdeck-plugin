# TossInvest Stream Deck 플러그인 작업 지침

## 프로젝트 목적

이 저장소는 토스증권 Open API의 국내·미국 주식 시세를 Stream Deck 키에 표시하는 비공식 플러그인이다. 계좌 조회, 보유자산, 주문, 조건주문은 범위에 포함하지 않는다.

## 구조와 책임

- `src/toss/auth-session.ts`: OAuth Client Credentials 단일 토큰 세션. Client Secret과 access token을 로그에 남기지 않는다.
- `src/toss/rest-client.ts`: 공식 REST 엔드포인트(`/oauth2/token`, `/api/v1/stocks`, `/prices`, `/candles`)와 그룹별 호출 간격을 관리한다.
- `src/toss/websocket.ts`: `wss://openapi-ws.tossinvest.com/ws/v1` 하나를 공유하고 full-replace 구독, 60초 PING, 재연결을 담당한다.
- `src/runtime.ts`: Stream Deck 액션과 API 상태를 연결한다. 여러 키의 같은 종목은 하나의 구독으로 합친다.
- `src/renderer/`: SVG 카드와 전역 30회/초 렌더 커밋 큐. 모든 틱을 그대로 `setImage`로 보내지 않는다.
- `com.saybgm.tossinvest.sdPlugin/ui/`: 외부 네트워크 없이 동작하는 Property Inspector.

## 안전 규칙

- 공식 API와 공개 토스 URL만 사용한다. 토스 웹 내부 API나 비공식 상품 코드 매핑을 추가하지 않는다.
- `/stocks` 응답으로 확인한 종목만 저장·구독한다. 코드 입력은 URL에 넣기 전에 정규식으로 검증한다.
- WebSocket 구독은 연결당 100개 이하로 제한한다. 구독 ack의 `rejected`는 해당 종목만 오류 처리한다.
- 401/403/429와 네트워크 오류를 구분하고, 사용자에게 표시하는 메시지에는 자격증명·토큰·전체 응답을 포함하지 않는다.
- `setGlobalSettings`에는 Client Secret이 들어갈 수 있으므로 커밋, 테스트 픽스처, 패키지, 로그에 실제 값이 없어야 한다.
- 공식 API 스펙이 바뀌면 `src/toss` 타입·픽스처·README의 확인일을 함께 갱신한다.

## 검증 명령

```sh
npm run typecheck
npm test
npm run build
npm run package:plugin
npm run package:smoke
```

`npm run verify`는 위 핵심 검사를 순서대로 실행한다. Stream Deck 실제 설치, macOS/Windows 런타임, 장중 체결, 절전 복귀는 자격증명과 실제 호스트가 필요하므로 실행 여부를 결과에 명시한다.

## 릴리스

버전은 `package.json`, `manifest.json`, `CHANGELOG.md`를 동시에 갱신한다. `dist/SHA256SUMS`를 생성하고 다운로드한 릴리스 파일을 다시 압축 해제해 핵심 파일과 금지 파일을 확인한다. GitHub 인증이 필요한 원격 저장소 생성·태그 push·Release 게시 전에는 사용자의 명시적 인증 상태를 확인한다.
