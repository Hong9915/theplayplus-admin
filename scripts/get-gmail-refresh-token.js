/**
 * 1회성 유틸: Gmail refresh token 발급용 스크립트.
 *
 * 사용법: .env.local에 GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET를 채워둔 뒤
 *   node scripts/get-gmail-refresh-token.js
 *
 * 실행하면 인증 URL이 출력됩니다. 브라우저에서 그 URL을 열고
 * 로그인/동의하면, 로컬 서버가 인증 코드를 받아 자동으로 refresh token을
 * 교환해 콘솔에 출력합니다.
 *
 * 발신 계정이 둘이므로 계정마다 한 번씩, 총 두 번 실행합니다:
 *   - 게임 문의 계정(help@)으로 로그인 → GMAIL_REFRESH_TOKEN / GMAIL_SENDER
 *   - 서비스 문의 계정(info@)으로 로그인 → GMAIL_SERVICE_REFRESH_TOKEN / GMAIL_SERVICE_SENDER
 * 이미 로그인된 다른 Google 계정으로 동의하지 않도록 계정 선택 화면에서 확인하세요.
 *
 * `--docs`를 붙이면 Gmail 대신 drive.file 스코프 토큰을 발급합니다. 게임 생성 시
 * 운영 현황 구글 문서를 그 계정 소유로 만드는 데 쓰며(lib/ops-doc.ts) 값은
 * GOOGLE_DOCS_REFRESH_TOKEN에 넣습니다. 문서를 소유할 계정(보통 help@)으로 로그인하세요.
 *   node scripts/get-gmail-refresh-token.js --docs
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { google } = require("googleapis");

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) process.env[key] = value.trim();
  }
}

async function main() {
  loadEnvLocal();

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      ".env.local에 GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET 값을 채워넣은 뒤 다시 실행하세요."
    );
    process.exit(1);
  }

  console.log(`사용할 client_id: ${clientId}`);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const docsMode = process.argv.includes("--docs");

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: docsMode
      ? // 이 앱이 만든 파일만 만들고 공유할 수 있는 최소 Drive 스코프.
        ["https://www.googleapis.com/auth/drive.file"]
      : [
          "https://www.googleapis.com/auth/gmail.send",
          // 사용자 회신을 스레드에서 읽어오는 데 필요하다. 예전 토큰은 send만 있어
          // 회신 확인이 실패하니, 스코프를 바꾸면 토큰을 다시 발급해야 한다.
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
  });

  console.log(
    docsMode
      ? "\n아래 URL을 브라우저에서 열고, 운영 현황 문서를 소유할 계정(보통 help@)으로 로그인/동의하세요:\n"
      : "\n아래 URL을 브라우저에서 열고, 토큰을 발급할 발신 계정(게임 문의 help@ 또는 서비스 문의 info@)으로 로그인/동의하세요:\n"
  );
  console.log(authUrl, "\n");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("인증 코드를 찾을 수 없습니다.");
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("인증이 완료되었습니다. 터미널을 확인하세요. 이 탭은 닫아도 됩니다.");

      if (docsMode) {
        console.log("\n발급 완료. GOOGLE_DOCS_REFRESH_TOKEN에 넣으세요:\n");
      } else {
        console.log("\n발급 완료. 로그인한 계정에 맞는 변수에 넣으세요:\n");
        console.log("  게임 문의 계정이면   GMAIL_REFRESH_TOKEN (발신 주소는 GMAIL_SENDER)");
        console.log("  서비스 문의 계정이면 GMAIL_SERVICE_REFRESH_TOKEN (발신 주소는 GMAIL_SERVICE_SENDER)\n");
      }
      console.log(`refresh_token=${tokens.refresh_token}\n`);

      if (!tokens.refresh_token) {
        console.warn(
          "refresh_token이 비어 있습니다. 이 계정이 이미 이 앱에 동의한 적이 있으면 " +
            "Google 계정 설정(https://myaccount.google.com/permissions)에서 앱 액세스를 제거한 뒤 다시 시도하세요."
        );
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("토큰 교환 중 오류가 발생했습니다. 터미널을 확인하세요.");
      console.error("토큰 교환 실패:", err);
    } finally {
      server.close();
    }
  });

  server.listen(PORT, () => {
    console.log(`로컬 서버 대기 중: ${REDIRECT_URI}`);
  });
}

main();
