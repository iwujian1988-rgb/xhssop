import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(
  process.argv[2] || "outputs/commercial-v1-final/batch_commercial_v1_1788485294624",
);

for (const jobId of ["job_001", "job_002", "job_003"]) {
  const expanded = path.join(root, jobId, "expanded");
  const files = (await fs.readdir(expanded))
    .filter((name) => name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const thumbWidth = 270;
  const thumbHeight = 360;
  const gap = 18;
  const columns = 3;
  const rows = Math.ceil(files.length / columns);
  const canvasWidth = columns * thumbWidth + (columns + 1) * gap;
  const canvasHeight = rows * thumbHeight + (rows + 1) * gap;
  const composites = [];

  for (let index = 0; index < files.length; index += 1) {
    const input = path.join(expanded, files[index]);
    const buffer = await sharp(input)
      .resize(thumbWidth, thumbHeight, { fit: "contain", background: "#ececec" })
      .png()
      .toBuffer();
    composites.push({
      input: buffer,
      left: gap + (index % columns) * (thumbWidth + gap),
      top: gap + Math.floor(index / columns) * (thumbHeight + gap),
    });
  }

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: "#d9d9d9",
    },
  })
    .composite(composites)
    .png()
    .toFile(path.join(root, jobId, `${jobId}-完整预览.png`));
}
