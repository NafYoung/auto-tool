import nodemailer from "nodemailer";
import type { EmailRuntime } from "./config.js";

export async function sendDigestEmail(
  runtime: EmailRuntime,
  reportDate: string,
  markdown: string,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: runtime.host,
    port: runtime.port,
    secure: runtime.port === 465,
    auth: {
      user: runtime.user,
      pass: runtime.pass,
    },
  });

  await transporter.sendMail({
    from: runtime.from,
    to: runtime.to,
    subject: `${runtime.subjectPrefix} ${reportDate}`,
    text: markdown,
  });
}
