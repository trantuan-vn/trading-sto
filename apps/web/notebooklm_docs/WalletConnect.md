::: mermaid
graph TD
    A[Bắt đầu: Yêu cầu thêm biểu tượng Reown Wallet] --> B{Phân tích kiến trúc hiện có};

    subgraph "1. Phát triển Component Biểu Tượng Reown Wallet"
        B --> B1[**File mới**: src/components/ui/reown-wallet-icon.tsx];
        B1 -- Nội dung --> B1a[Định nghĩa React Component bằng TypeScript];
        B1a -- Chứa --> B1b[Mã SVG hoặc Icon Component của Reown Wallet];
        B1b -- Định kiểu --> B1c[Áp dụng Tailwind CSS cho kích thước và màu sắc];
        style B1 fill:#afa,stroke:#333,stroke-width:2px;
    end

    subgraph "2. Phát triển Component Nút Kết Nối Ví"
        B1c --> C1[**File mới**: src/components/ui/wallet-connect-button.tsx];
        C1 -- Nội dung --> C1a[Định nghĩa React Component WalletConnectButton bằng TypeScript];
        C1a -- Nhập khẩu --> C1b[Import ReownWalletIcon từ 'src/components/ui/reown-wallet-icon.tsx'];
        C1b -- Logic UI --> C1c[Thêm `onClick` handler để xử lý sự kiện kết nối/ngắt kết nối ví];
        C1c -- Quản lý trạng thái cục bộ --> C1d[Sử dụng **`useState`** phương pháp chính để theo dõi trạng thái kết nối `isConnected`, `walletAddress` 2];
        C1d -- Hiển thị --> C1e[Hiển thị biểu tượng/text Kết nối ví hoặc địa chỉ ví tùy trạng thái];
        C1e -- Định kiểu --> C1f[Áp dụng Tailwind CSS cho nút và trạng thái hover];
        style C1 fill:#afa,stroke:#333,stroke-width:2px;
    end

    subgraph "3. Tích hợp vào Layout Chính của Dashboard"
        C1f --> D1[**File sửa đổi**: src/app/main/dashboard/layout.tsx];
        D1 -- Nhập khẩu --> D1a[Import WalletConnectButton từ 'src/components/ui/wallet-connect-button.tsx'];
        D1a -- Chèn vào DOM --> D1b[Đặt WalletConnectButton vào phần **Header/Navbar** của layout];
        D1b -- Vị trí cụ thể --> D1c[Căn chỉnh để nó xuất hiện ở góc trên bên phải, gần các biểu tượng người dùng hoặc menu điều hướng khác hiện có];
        style D1 fill:#f9f,stroke:#333,stroke-width:2px;
    end

    subgraph "4. Xây dựng Logic & Trạng thái Ví Nâng cao (Tùy chọn)"
        C1d --> E1[**File mới tùy chọn**: src/lib/wallet-utils.ts];
        E1 -- Chức năng --> E1a[Định nghĩa các hàm tiện ích cho ví ví dụ: `connectToProvider`, `disconnectWallet`, `getAccountBalance`, `signTransaction` 1-3];
        E1a -- Tương tác --> E1b[Tích hợp với thư viện Web3 ví dụ: ethers.js, web3.js để giao tiếp với blockchain];

        C1d --> F1[**File mới tùy chọn**: src/stores/wallet/wallet-store.ts];
        F1 -- Mục đích --> F1a[Quản lý trạng thái ví **toàn cục** isConnected, address, provider, networkId nếu cần chia sẻ rộng rãi giữa nhiều component 1, 2, 4];
        F1a -- Cơ chế --> F1b[Sử dụng cấu trúc store hiện có trong `src/stores` 1, 2, 4 ví dụ: tương tự `preferences-store.ts`];
        style E1 fill:#afa,stroke:#333,stroke-width:2px;
        style F1 fill:#afa,stroke:#333,stroke-width:2px;
    end

    D1c --> G[Kiểm tra, Debug & Triển khai];
    G --> H[Kết thúc];
:::