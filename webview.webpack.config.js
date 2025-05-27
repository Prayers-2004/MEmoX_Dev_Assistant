const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    target: 'web',
    mode: 'development',
    entry: './src/webview-ui/index.tsx',
    output: {
        path: path.resolve(__dirname, 'dist', 'webview-ui'),
        filename: 'index.js',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: 'ts-loader',
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader', 'postcss-loader'],
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/webview-ui/index.html',
        }),
    ],
    devtool: 'source-map',
}; 