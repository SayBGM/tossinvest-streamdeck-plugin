# TossInvest for Stream Deck

토스증권 Open API로 국내·미국 주식의 현재가를 Stream Deck 키에서 확인하는 비공식 플러그인입니다.

> 이 플러그인은 토스증권이 제공·보증하는 공식 제품이 아닙니다. 표시되는 데이터는 지연되거나 일시적으로 비어 있을 수 있으며 투자 권유가 아닙니다.

## 제공 기능

- 국내 종목코드(`005930`)와 미국 티커(`AAPL`) 입력
- 종목명·통화·시장 자동 확인
- 현재가와 직전 거래일 일봉 종가 대비 등락액·등락률 표시
- 공식 WebSocket 체결 스트림 기반 실시간 모드와 1초 절약형 모드
- 키별 `즉시 새로고침`, `토스증권 종목 열기`, `동작 없음`
- 같은 종목을 여러 키에 배치해도 API 구독은 하나로 공유

계좌·보유자산·주문·조건주문은 의도적으로 제공하지 않습니다.

## 준비

1. 토스증권 WTS에서 **설정 → Open API**로 Client ID와 Client Secret을 발급합니다.
2. 같은 화면의 **허용 IP 관리**에 플러그인이 실행될 컴퓨터의 공인 IP를 등록합니다.
3. [토스증권 Open API 문서](https://developers.tossinvest.com/docs)를 확인합니다.
4. Stream Deck 6.9 이상과 Node.js 20 런타임이 필요합니다. macOS 13 이상 또는 Windows 10 이상을 지원합니다.

## 설치

`dist/com.saybgm.tossinvest.streamDeckPlugin`을 다운로드한 뒤 더블클릭해 Stream Deck에 설치합니다. GitHub Release에는 같은 파일과 `SHA256SUMS`가 함께 제공됩니다.

현재 개발 환경에서 패키지 생성은 다음으로 수행합니다.

```sh
npm install
npm run verify
npm run package:plugin
npm run package:smoke
```

## 설정

플러그인을 추가한 뒤 Property Inspector에서 Client ID/Secret을 입력하고 **전역 설정 저장 → 연결 테스트**를 누릅니다. 자격증명은 이 컴퓨터의 Stream Deck 설정에 저장되며 OS 보안 저장소를 사용하지 않습니다. 실제 값을 저장소, 이슈, 로그, 화면 녹화, CI 변수에 올리지 마세요.

각 키의 종목 코드에 `005930` 또는 `AAPL`을 입력하고 **종목 확인**을 누르면 종목명·시장·통화가 저장됩니다. 미국 종목의 토스증권 열기 URL은 티커 경로를 사용하며 토스 웹이 내부 상품 코드로 리다이렉트합니다.

## 데이터 동작

- 시작·종목 변경·수동 새로고침: `/api/v1/stocks`, `/api/v1/prices`, 조정 일봉 `/api/v1/candles`를 호출합니다.
- 연결 후: `trade:kr` 또는 `trade:us` 체결 WebSocket을 구독합니다.
- WebSocket 단절: 최대 100개 종목을 한 번에 묶어 REST 폴백을 시도하고 지수 백오프로 재연결합니다.
- 화면 갱신: 모든 체결을 메모리의 최신 상태에 반영하지만 Stream Deck `setImage` 호출은 전역 큐에서 합쳐 초당 30회 이하로 제한합니다.

## 개발 경계

이 저장소의 자동 테스트는 모의 REST/WebSocket과 카드 렌더링을 검증합니다. 실제 토스 인증, 허용 IP, 국내·미국 장중 체결, 절전 복귀는 사용자의 자격증명과 실제 Stream Deck 호스트에서 별도 검증해야 합니다. 실제 자격증명은 테스트 픽스처로 커밋하지 않습니다.

## GitHub Actions

- `CI`: push/PR마다 macOS와 Windows에서 `npm ci`, 타입 검사, 테스트, 빌드, 패키지 스모크를 실행합니다.
- `Release`: `v*` 태그 push 시 검증·패키징·SHA-256 확인 후 GitHub Release에 설치 패키지와 체크섬을 업로드합니다.

## 라이선스

MIT. 토스증권의 상표·로고 권리는 각 권리자에게 있습니다.
