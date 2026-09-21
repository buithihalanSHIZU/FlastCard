# JLPT N1 Grammar PWA

Mở ứng dụng qua máy chủ web tĩnh, ví dụ:

```sh
python3 -m http.server 8080
```

Sau đó mở `http://localhost:8080` trong Safari. Trên iPhone/iPad, dùng nút Chia sẻ rồi chọn **Thêm vào Màn hình chính**. Khi triển khai thật, dùng HTTPS để service worker và cài PWA hoạt động đầy đủ.

`quiz-data.json` là database riêng cho chế độ **Kiểm tra** và phải được upload cùng các file web còn lại.
