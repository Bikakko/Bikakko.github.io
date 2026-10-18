/**
 * 站点基础与卡片配置文件
 * 您可以在这里直接增加、修改、删除卡片，或者更改标题与神秘入口链接
 */
export const SITE_CONFIG = {
    // 网页标题与元信息
    meta: {
        title: "Moon",
        description: "Personal Space & Interactive Portal",
        favicon: "./assets/images/favicon.jpg",
    },

    // 月球上的神秘入口配置
    secretEntry: {
        enabled: true,
        // 点击跳转的链接 (可以是您的后台、博客、社交账号等)
        url: "https://github.com",
        // 打开方式: "_blank" 新标签页 / "_self" 当前标签页
        target: "_blank",
        // 图标与加载失败兜底图
        image: "./assets/images/secret-entry.gif",
        fallbackImage: "./assets/images/favicon.jpg",
        ariaLabel: "Open Secret Entry",
    },

    // 页面卡片贴图与外链配置 (支持按需增减)
    cards: [
        {
            id: "card-1",
            title: "GoTube Portal",
            subtitle: "Media & Archive",
            imageUrl: "./assets/images/png.png",
            linkUrl: "https://github.com", // 预留跳转链接
            target: "_blank",
            badge: "GoTube",
        },
    ],

    // 3D 场景高级配置 (可选自定义)
    scene: {
        moonTexture: "./assets/images/moon.png",
        enableGyroscope: true, // 是否在移动端启用陀螺仪重力感应

        // 星空自转：模拟真实星空的东升西落
        // 每分钟转过的角度 (真实星空是 0.25°/分钟，这里默认 12° 属于慢速时移)
        starRotationDegPerMinute: 12,
        // 转轴与竖直方向的夹角 (度)，设成当地纬度即可让北极星停在正上方附近
        starRotationTilt: 35,
    },
};
