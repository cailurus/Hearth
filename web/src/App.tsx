import { Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'

export default function App() {
  return (
    <div className="min-h-full">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<HomePage initialDialog="login" />} />
      </Routes>
    </div>
  )
}
