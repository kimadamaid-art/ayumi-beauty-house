'use client'

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
    PieChart,
    Pie,
    Cell
} from 'recharts'

// Diserahkan apa adanya ke fungsi render pemanggil. recharts mengenali anak-anaknya
// (<XAxis>, <Bar>, <Cell>, ...) dari tipe komponennya, jadi grafik harus dibangun dari
// komponen asli ini -- bukan dari pembungkus next/dynamic per komponen, yang akan
// membuat grafik tampil kosong tanpa pesan error.
const Recharts = {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
    PieChart,
    Pie,
    Cell
}

export default function RechartsRenderer({ render }) {
    return render(Recharts)
}
