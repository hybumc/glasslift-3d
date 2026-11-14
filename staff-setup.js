import crypto from "node:crypto";

const askHidden = (prompt) => new Promise((resolve) => {
  process.stdout.write(prompt);
  const input = process.stdin;
  if (!input.isTTY) throw new Error("Komutu etkileşimli, güvenli bir terminalde çalıştırın.");
  input.setRawMode(true);
  let value = "";
  const onData = (chunk) => {
    const char = chunk.toString();
    if (char === "\u0003") process.exit(1);
    if (char === "\r" || char === "\n") {
      input.removeListener("data", onData);
      input.setRawMode(false);
      process.stdout.write("\n");
      resolve(value);
    } else if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
    else if (char >= " ") value += char;
  };
  input.on("data", onData);
});

try {
  const password = await askHidden("Personel parolası (ekranda gösterilmez): ");
  if (password.length < 8) throw new Error("Parola en az 8 karakter olmalı.");
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  console.log(`STAFF_PASSWORD_HASH=scrypt$16384$${salt.toString("hex")}$${hash.toString("hex")}`);
  console.log("Bu satırı barındırma sağlayıcınızın gizli ortam değişkeni olarak kaydedin.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  process.stdin.pause();
}
