# Sefa Okey 101

Türkçe, mobil uyumlu 101 Okey: botlarla tek kişilik oyun, beş karakterli oda koduyla arkadaş masası, rastgele oyuncu eşleştirme ve yetkili personel paneli. Oyun sunucusu taşları dağıtır ve sıraları doğrular; rakiplerin elleri oyunculara gönderilmez.

## Geliştirme

- Node.js 22 veya üstü kurun.
- `npm ci`
- `npm test`
- `npm start` ile uygulamayı `http://localhost:3000` adresinde açın.

Botlu masa çevrimdışı oynanır. Rastgele eşleştirme ve özel oda gerçek bir oyun sunucusu bağlantısı ister. Rastgele eşleşmede en az iki kişi bekliyorsa oyun başlar ve boş koltuklar botlarla dolar; 20 saniyede kimse gelmezse oyuncuya botlu masa seçeneği sunulur. Özel oda sahibi botlarla masayı başlatabilir.

## Personel parolası

Parola istemci koduna, Git geçmişine veya yapılandırma dosyasına konmaz. `node staff-setup.js` komutu parolayı gizli terminal girdisiyle alır ve `STAFF_PASSWORD_HASH` için scrypt özetini üretir. Yalnızca üretilen özeti barındırma ortamının gizli değişkenine kaydedin. Sunucu ortamında bu değişken boşsa personel girişi kapalıdır. Giriş belirteci sunucu belleğinde tutulur ve 8 saat sonra geçersiz olur.

Yerel geliştirme için `.env.example` içeriğindeki değişkenleri terminal ortamında ayarlayın; uygulama `.env` dosyalarını otomatik yüklemez ve sırları dosyalara koymayın.

## Sunucuya dağıtım

`render.yaml` tek sunuculu Render hizmetini ve sağlık kontrolünü tanımlar. Render panelinde Blueprint'i dağıtın, `STAFF_PASSWORD_HASH` değerini `staff-setup.js` çıktısıyla gizli değişken olarak ayarlayın ve `ALLOWED_ORIGIN` değerini uygulamanın gerçek HTTPS adresiyle eşleştirin. Hizmet WebSocket desteklemeli ve tek örnek çalışmalıdır. Oyun odaları, kuyruk ve ban listesi bellekte tutulur; sunucu yeniden başlayınca sıfırlanırlar. Kalıcı kullanıcı hesapları, yeniden bağlanma ve farklı örneklere yayılmış eşleştirme bu sürümde yoktur. Bu nedenle banlama geçici oturum moderasyonudur; hesapları cihazlar arasında kalıcı olarak yasaklamaz.

## Windows ve Android

GitHub Actions etiketi `v*` olan her push'ta Windows kurulum `.exe` dosyası ve Android debug APK üretir, ardından GitHub Release'e ekler. İmzalı Android/Play Store dağıtımı için kullanıcıya ait kalıcı imzalama anahtarı ve GitHub Actions secret'ları gereklidir; bu depoda anahtar yoktur. Windows uygulaması çevrimiçi sunucuyu dener, erişemezse yerel sunucu açarak botlu masayı çalıştırır. Android uygulaması oyun dosyalarını içine alır; gerçek oyuncular/odalar için `public/app.js` içindeki üretim sunucu adresini ve `render.yaml` içindeki izinli origin listesini kendi HTTPS dağıtım adresinizle güncelleyin. İmzasız debug APK test/yan yükleme içindir, Play Store sürümü değildir.
