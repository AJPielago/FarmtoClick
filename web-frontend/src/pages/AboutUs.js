import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const AboutUs = () => {

  const teamMembers = [
    {
      name: 'Alex Joyous D. Pielago',
      role: 'Lead Developer',
      image: '/team/member1.jpg',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com',
        facebook: 'https://facebook.com/akuro10',
      },
    },
    {
      name: 'Dweight McKaine L. Mandawe',
      role: 'Assistant Developer',
      image: '/team/member2.jpg',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com/dweinm',
        facebook: 'https://https://www.facebook.com/dwein.mandawe.com',
      },
    },
    {
      name: 'Gerald Loise P. Garcia',
      role: 'Lead Researcher',
      image: '/team/member3.jpg',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com/loise1630',
        facebook: 'https://facebook.com/grldgrc',
      },
    },
    {
      name: 'Josh Christian I. Bernabe',
      role: 'Documentation Lead',
      image: '/team/member4.jpg',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com/in/josh-christian-bernabe-b22391179/',
        github: 'https://github.com/printlnreaperdoc',
        facebook: 'https://facebook.com/joshchristian.bernabe.x.676',
      },
    },
  ];

  return (
    <div className="about-us-page">
      <Navbar activePage="about" />

      <div className="container" style={{ marginTop: '100px', marginBottom: '60px' }}>
        <div className="section-header">
          <span className="section-badge">Team</span>
          <h2>The Development Team</h2>
          <p>The people behind FarmtoClick</p>
        </div>
        <div className="team-grid">
          {teamMembers.map((member, index) => (
            <div key={index} className="team-card" style={{ padding: '30px 20px' }}>
              <div className="team-avatar" style={{ marginBottom: '15px' }}>
                {member.image ? (
                  <img
                    src={member.image}
                    alt={member.name}
                    style={{ width: '100px', height: '100px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <i className={`fas ${member.icon}`}></i>
                )}
              </div>
              <h3 style={{ marginBottom: '5px' }}>{member.name}</h3>
              <p className="team-role" style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>
                {member.role}
              </p>
              <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '15px' }}>
                <p style={{ margin: '0' }}>{member.campus}</p>
                <p style={{ margin: '0' }}>{member.year}</p>
              </div>

              <div className="team-socials" style={{ display: 'flex', justifyContent: 'center', gap: '15px' }}>
                {member.socials.linkedin && (
                  <a
                    href={member.socials.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#0077b5', fontSize: '1.2rem' }}
                  >
                    <i className="fab fa-linkedin"></i>
                  </a>
                )}
                {member.socials.github && (
                  <a
                    href={member.socials.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#333', fontSize: '1.2rem' }}
                  >
                    <i className="fab fa-github"></i>
                  </a>
                )}
                {member.socials.facebook && (
                  <a
                    href={member.socials.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#1877f2', fontSize: '1.2rem' }}
                  >
                    <i className="fab fa-facebook"></i>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Footer />
    </div>
  );
};
export default AboutUs;
