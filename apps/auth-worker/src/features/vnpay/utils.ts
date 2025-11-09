// Private helper functions
export function sortObjectUtil(obj: Record<string, any>): Record<string, any> {
  const sorted: Record<string, any> = {};
  const str = [];
  let key;
  
  for (key in obj) {
    if (obj.hasOwnProperty(key)) {
      str.push(encodeURIComponent(key));
    }
  }
  
  str.sort();
  
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
  }
  
  return sorted;
}

export function getResponseMessage(responseCode: string): string {
  const messages: Record<string, string> = {
    '00': 'Giao dịch thành công',
    '07': 'Trừ tiền thành công. Giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường).',
    '09': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng chưa đăng ký dịch vụ InternetBanking',
    '10': 'Giao dịch không thành công do: Khách hàng xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
    '11': 'Giao dịch không thành công do: Đã hết hạn chờ thanh toán. Xin quý khách vui lòng thực hiện lại giao dịch.',
    '12': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng bị khóa.',
    '13': 'Giao dịch không thành công do Quý khách nhập sai mật khẩu xác thực giao dịch (OTP). Xin quý khách vui lòng thực hiện lại giao dịch.',
    '24': 'Giao dịch không thành công do: Khách hàng hủy giao dịch',
    '51': 'Giao dịch không thành công do: Tài khoản của quý khách không đủ số dư để thực hiện giao dịch.',
    '65': 'Giao dịch không thành công do: Tài khoản của Quý khách đã vượt quá hạn mức giao dịch trong ngày.',
    '75': 'Ngân hàng thanh toán đang bảo trì.',
    '79': 'Giao dịch không thành công do: KH nhập sai mật khẩu thanh toán quá số lần quy định. Xin quý khách vui lòng thực hiện lại giao dịch',
    '99': 'Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê)'
  };
  
  return messages[responseCode] || 'Unknown error';
}

export function getQueryDRMessage(responseCode: string): string {
  const messages: Record<string, string> = {
    '00': 'Yêu cầu thành công',
    '02': 'Mã định danh kết nối không hợp lệ (kiểm tra lại TmnCode)',
    '03': 'Dữ liệu gửi sang không đúng định dạng' ,
    '91': 'Không tìm thấy giao dịch yêu cầu' ,
    '94': 'Yêu cầu trùng lặp, duplicate request trong thời gian giới hạn của API' ,
    '97': 'Checksum không hợp lệ' ,
    '99': 'Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê)'
  };
  return messages[responseCode] || 'Unknown error';
}

export function getRefundMessage(responseCode: string): string {
  const messages: Record<string, string> = {
    '00': 'Yêu cầu thành công',
    '02': 'Mã định danh kết nối không hợp lệ (kiểm tra lại TmnCode)',
    '03': 'Dữ liệu gửi sang không đúng định dạng',
    '91': 'Không tìm thấy giao dịch yêu cầu hoàn trả',
    '94': 'Giao dịch đã được gửi yêu cầu hoàn tiền trước đó. Yêu cầu này VNPAY đang xử lý',
    '95': 'Giao dịch này không thành công bên VNPAY. VNPAY từ chối xử lý yêu cầu',
    '97': 'Checksum không hợp lệ',
    '99': 'Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê)'
  };
  return messages[responseCode] || 'Unknown error';
}