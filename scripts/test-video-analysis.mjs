import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';

const key = JSON.parse(fs.readFileSync('data/settings.json', 'utf8')).apiKey;
const ai = new GoogleGenAI({ apiKey: key });
const b64 = fs.readFileSync('data/test/frame-sample.jpg').toString('base64');

const prompt = `Bạn là trợ lý AI chuyên gia dựng video và thiết kế phụ đề.
Hãy phân tích hình ảnh khung hình video và danh sách các câu phụ đề sau:
[
  { "id": 0, "text": "Chào mừng các bạn đến với VideoStudio công cụ biên tập video tự động cực đỉnh" }
]

Yêu cầu phân tích:
1. Phân tích bố cục hình ảnh: Nhận diện xem người nói/chủ thể chính nằm ở đâu (trên, giữa hay dưới)? Vùng an toàn nhất để đặt phụ đề mà không che mặt hay chi tiết quan trọng là: "bottom", "middle" (hơi thấp hơn giữa), hay "top"?
2. Phong cách đề xuất ("recommendedStyle"): "tiktok" (sôi nổi, pop-in, câu ngắn), "classic" (chữ rõ ràng nền mờ dễ đọc), hoặc "minimal" (thanh lịch, tinh tế).
3. Màu nhấn đề xuất ("highlightColor"): mã hex (ví dụ "#c8ff3d" xanh lime, "#ffe100" vàng, "#ff4f7b" hồng, "#45c8ff" cyan).
4. Với từng câu:
   - "keywords": danh sách các từ hoặc cụm từ quan trọng cần highlight đổi màu để thu hút người xem.
   - "emoji": emoji phù hợp nhất nếu câu có cảm xúc/chủ đề rõ ràng (hoặc "" nếu không cần).

Trả về định dạng JSON thuần:
{
  "safePosition": "bottom",
  "recommendedMarginV": 0.12,
  "recommendedStyle": "tiktok",
  "highlightColor": "#c8ff3d",
  "tone": "energetic",
  "captions": [
    { "id": 0, "keywords": ["VideoStudio", "cực đỉnh"], "emoji": "⚡" }
  ]
}`;

const res = await ai.models.generateContent({
  model: 'gemini-3.5-flash-lite',
  contents: [
    { inlineData: { mimeType: 'image/jpeg', data: b64 } },
    prompt
  ],
  config: { responseMimeType: 'application/json' }
});

console.log('Result:', JSON.parse(res.text));
