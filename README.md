# 🎬 VideoStudio

Tool cá nhân giúp **tự động chỉnh sửa video theo mẫu**: tải video lên → chọn mẫu → xem trước → xuất.
Mọi thứ chạy trên máy bạn (Node.js + FFmpeg đóng gói sẵn), chỉ phần phụ đề AI gọi Gemini API.

## Chạy

```bash
npm install      # lần đầu
npm start        # mở http://localhost:5173
```

Hoặc bấm đúp `start.bat`.

Phụ đề AI cần **Gemini API key** (miễn phí tại https://aistudio.google.com/apikey):
nhập trong ⚙ Cài đặt trên giao diện, hoặc đặt biến môi trường `GEMINI_API_KEY`.

## Mẫu có sẵn

| Mẫu | Hiệu ứng |
|---|---|
| 🔥 TikTok Viral | 9:16 nền mờ · màu rực · cắt lặng · phụ đề karaoke · watermark |
| ▶️ Shorts Gọn Gàng | 9:16 crop · phụ đề nền đen · fade |
| 🎙️ Podcast / Talking | cắt lặng gắt · phụ đề karaoke · tông ấm |
| 🎬 Điện Ảnh | teal & orange · letterbox · grain · tiêu đề · fade |
| 📼 Phim Cũ Retro | vintage · grain dày · vignette |
| 🖤 Đen Trắng Nghệ Thuật | B&W tương phản cao |
| ☀️ Vlog Tươi Sáng | tông ấm · tiêu đề · outro · nhạc nền (tự giảm khi có tiếng nói) |
| 🌸 Slow-mo Mơ Màng | 0.5x · glow |
| ⏩ Timelapse | 4x · tắt tiếng |
| 🔁 Boomerang | lặp tới-lui |
| 🌧️ Moody | tông trầm |
| 📸 Instagram Vuông | 1:1 nền mờ |
| ✨ Tự Do | tự bật hiệu ứng |

Mọi thông số đều chỉnh được ở tab **Tinh chỉnh**. Thêm mẫu mới: sửa `server/templates.js`,
hoặc bấm **Lưu thành mẫu** trên giao diện (lưu vào `data/user-templates.json`).

## Tính năng chỉnh sửa

- **Hiệu ứng trực tiếp (LIVE)**: khung, màu, hạt phim, viền đen, tiêu đề, watermark, outro, fade, tốc độ, nhạc nền
  được mô phỏng ngay trên video gốc khi bạn đổi mẫu hoặc thông số (cắt lặng/boomerang xem bằng *Xem trước 8s*).
- **Cắt đầu/cuối**: kéo 2 tay cầm trên timeline có ảnh thu nhỏ, hoặc nhấn `I` / `O` tại vị trí đang xem.
- **Biên tập phụ đề**: AI chép lời → sửa chính tả / xoá câu → xuất bằng bản đã sửa (kèm file .SRT).
- **Chuẩn hoá âm lượng** (-14 / -16 / -23 LUFS) cho TikTok, YouTube, podcast.
- **Mẫu của tôi** + bộ lọc mẫu (Khung dọc, Phụ đề AI, Màu phim, Tốc độ).
- Tự **khôi phục phiên làm việc** khi tải lại trang; thông báo trình duyệt khi xuất xong.

Phím tắt: `Space` phát/dừng · `←` `→` tua 1s (`Shift` 5s) · `I` `O` cắt · `P` xem trước ·
`Ctrl+Enter` xuất · `L` bật/tắt hiệu ứng trực tiếp · `M` tắt tiếng · `Esc` đóng bảng.

## Cấu trúc

```
server/index.js      API (upload, render job + SSE tiến độ, lịch sử, cài đặt)
server/pipeline.js   3 bước FFmpeg: timeline (cắt lặng/tốc độ) → phụ đề AI → look (khung, màu, chữ, nhạc)
server/subtitles.js  Gemini 3.5 Transcribe (timestamp từng từ) → ASS karaoke / SRT
server/templates.js  Cấu hình mặc định + các mẫu
public/              Giao diện (HTML/CSS/JS thuần)
data/                Video tải lên, video xuất, cache (tự tạo)
```

`npm test` — dựng thử tất cả mẫu trên clip test để kiểm tra pipeline.
