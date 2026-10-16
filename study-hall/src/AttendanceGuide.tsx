export function CheckoutGuide() {
  return (
    <p className="checkout-guide">
      정상 종료 시 자동 퇴실됩니다. 월·화 오후 4:30 / 수·목·금 오후 3:30. 퇴실
      QR은 조퇴 등 중간에 나갈 때만 찍어 주세요.
    </p>
  );
}
export function CameraGuide() {
  return (
    <p className="camera-guide">
      QR이 안 되면 새로고침한 뒤 ‘카메라 시작 / 재시도’를 누르고 카메라 권한을
      ‘허용’해 주세요. 이미 차단했다면 브라우저의 사이트 설정에서 카메라를
      허용해 주세요.
    </p>
  );
}
